using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Tides.Api.Models;

namespace Tides.Api.Services;

/// <summary>
/// NOAA CO-OPS (Tides and Currents), covering the US west coast stations.
/// </summary>
public class NoaaApiService : ITideDataSource
{
    // NOAA publishes thousands of stations nationwide; this app only covers the west coast.
    // Every station in these three states is Pacific time, so the timezone comes from here
    // too - the station metadata only gives a fixed UTC offset, which would lose DST.
    private static readonly Dictionary<string, string> CoveredStates = new()
    {
        ["WA"] = "America/Los_Angeles",
        ["OR"] = "America/Los_Angeles",
        ["CA"] = "America/Los_Angeles",
    };

    // NOAA predictions are published relative to Mean Lower Low Water.
    private const string PredictionDatum = "MLLW";

    private readonly HttpClient _httpClient;
    private readonly IMemoryCache _cache;
    private readonly ILogger<NoaaApiService> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public NoaaApiService(IHttpClientFactory httpClientFactory, IMemoryCache cache, ILogger<NoaaApiService> logger)
    {
        _httpClient = httpClientFactory.CreateClient("NOAA");
        _cache = cache;
        _logger = logger;
    }

    public StationSource Source => StationSource.Noaa;

    public async Task<List<Station>> GetAllStationsAsync()
    {
        const string cacheKey = "noaa_stations_all";
        if (_cache.TryGetValue(cacheKey, out List<Station>? stations))
            return stations!;

        var response = await _httpClient.GetAsync("mdapi/prod/webapi/stations.json?type=tidepredictions&units=metric");
        response.EnsureSuccessStatusCode();
        var raw = await response.Content.ReadFromJsonAsync<NoaaStationList>(JsonOptions);

        stations = raw?.Stations
            .Where(s => s.State != null && CoveredStates.ContainsKey(s.State))
            // Subordinate stations ("S") only publish high/low offsets from a parent and
            // error out on an interval request, so they can't feed the chart. Only the
            // reference stations ("R") have the harmonics for a continuous series.
            .Where(s => s.Type == "R")
            .Select(s => new Station
            {
                Id = s.Id,
                Code = s.Id,
                OfficialName = s.Name,
                Latitude = s.Lat,
                Longitude = s.Lng,
                // The prediction station list doesn't say whether a live gauge exists.
                // GetObservedWaterLevelAsync discovers that per request and the current
                // level endpoint falls back to predictions when it comes back empty.
                Operating = false,
                TimeZone = CoveredStates[s.State!],
                Source = StationSource.Noaa,
                Datum = PredictionDatum,
            })
            .ToList() ?? [];

        _cache.Set(cacheKey, stations, TimeSpan.FromHours(24));
        return stations;
    }

    public async Task<List<TideDataPoint>> GetTidePredictionsAsync(string stationId, DateTime from, DateTime to)
    {
        var cacheKey = $"noaa_tides_{stationId}_{from:yyyyMMddHHmm}_{to:yyyyMMddHHmm}";
        if (_cache.TryGetValue(cacheKey, out List<TideDataPoint>? cached))
            return cached!;

        // Unlike IWLS, NOAA serves a full year of 15-minute predictions in one request,
        // so there's no need to chunk the range.
        var url = BuildDataUrl("predictions", stationId, from, to) + "&interval=15";
        var payload = await GetDataAsync(url, stationId);
        var points = ToDataPoints(payload?.Predictions);

        _cache.Set(cacheKey, points, TimeSpan.FromHours(6));
        return points;
    }

    public async Task<List<TideDataPoint>> GetObservedWaterLevelAsync(string stationId, DateTime from, DateTime to)
    {
        var cacheKey = $"noaa_wlo_{stationId}_{from:yyyyMMddHHmm}_{to:yyyyMMddHHmm}";
        if (_cache.TryGetValue(cacheKey, out List<TideDataPoint>? cached))
            return cached!;

        var url = BuildDataUrl("water_level", stationId, from, to);
        var payload = await GetDataAsync(url, stationId);
        var points = ToDataPoints(payload?.Data);

        _cache.Set(cacheKey, points, TimeSpan.FromMinutes(5));
        return points;
    }

    private static string BuildDataUrl(string product, string stationId, DateTime from, DateTime to)
    {
        var fromStr = Uri.EscapeDataString(from.ToUniversalTime().ToString("yyyyMMdd HH:mm", CultureInfo.InvariantCulture));
        var toStr = Uri.EscapeDataString(to.ToUniversalTime().ToString("yyyyMMdd HH:mm", CultureInfo.InvariantCulture));

        return $"api/prod/datagetter?product={product}&station={stationId}" +
               $"&begin_date={fromStr}&end_date={toStr}" +
               $"&datum={PredictionDatum}&units=metric&time_zone=gmt&format=json";
    }

    private async Task<NoaaDataResponse?> GetDataAsync(string url, string stationId)
    {
        _logger.LogDebug("NOAA API request: {Url}", url);
        var response = await _httpClient.GetAsync(url);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<NoaaDataResponse>(JsonOptions);

        // NOAA reports "no data at this station" as a 200 with an error body rather than
        // a status code, so this has to be checked explicitly. Callers treat an empty
        // list the same way they treat a station with no gauge.
        if (payload?.Error != null)
        {
            _logger.LogDebug("NOAA returned no data for station {StationId}: {Message}", stationId, payload.Error.Message);
            return null;
        }

        return payload;
    }

    private static List<TideDataPoint> ToDataPoints(List<NoaaPoint>? raw)
    {
        if (raw == null) return [];

        var points = new List<TideDataPoint>(raw.Count);
        foreach (var p in raw)
        {
            // Requested with time_zone=gmt, so the timestamps come back in UTC.
            if (!DateTime.TryParseExact(p.T, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var timestamp))
                continue;

            if (!double.TryParse(p.V, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                continue;

            points.Add(new TideDataPoint
            {
                Timestamp = DateTime.SpecifyKind(timestamp, DateTimeKind.Utc),
                Value = value
            });
        }

        return points;
    }

    // Internal DTOs matching the NOAA CO-OPS response shapes
    private class NoaaStationList
    {
        public List<NoaaStation> Stations { get; set; } = [];
    }

    private class NoaaStation
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public double Lat { get; set; }
        public double Lng { get; set; }
        public string? State { get; set; }

        /// <summary>"R" for a reference (harmonic) station, "S" for a subordinate one.</summary>
        public string? Type { get; set; }
    }

    private class NoaaDataResponse
    {
        public List<NoaaPoint>? Predictions { get; set; }
        public List<NoaaPoint>? Data { get; set; }
        public NoaaError? Error { get; set; }
    }

    private class NoaaPoint
    {
        public string T { get; set; } = string.Empty;
        public string V { get; set; } = string.Empty;
    }

    private class NoaaError
    {
        public string Message { get; set; } = string.Empty;
    }
}
