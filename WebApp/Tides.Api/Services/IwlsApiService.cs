using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Tides.Api.Models;

namespace Tides.Api.Services;

public class IwlsApiService : ITideDataSource
{
    // IWLS predictions are published relative to Chart Datum.
    private const string PredictionDatum = "Chart Datum";

    private readonly HttpClient _httpClient;
    private readonly IMemoryCache _cache;
    private readonly ILogger<IwlsApiService> _logger;
    private static readonly SemaphoreSlim _rateLimiter = new(1, 1);
    private static DateTime _lastRequestTime = DateTime.MinValue;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public IwlsApiService(IHttpClientFactory httpClientFactory, IMemoryCache cache, ILogger<IwlsApiService> logger)
    {
        _httpClient = httpClientFactory.CreateClient("IWLS");
        _cache = cache;
        _logger = logger;
    }

    public StationSource Source => StationSource.Iwls;

    public async Task<List<Station>> GetAllStationsAsync()
    {
        var cacheKey = "stations_all";
        if (_cache.TryGetValue(cacheKey, out List<Station>? allStations))
            return allStations!;

        var response = await RateLimitedGetAsync("stations");
        var rawStations = await response.Content.ReadFromJsonAsync<List<IwlsStation>>(JsonOptions);
        allStations = rawStations?
            // Roughly a third of IWLS stations carry no water level prediction series at
            // all, and asking for predictions there 404s. Drop them so every station we
            // surface - in search results and as a dot on the map - is actually usable.
            .Where(s => s.TimeSeries?.Any(t => t.Code == "wlp") == true)
            .Select(s => new Station
            {
                Id = s.Id,
                Code = s.Code,
                OfficialName = s.OfficialName,
                Latitude = s.Latitude,
                Longitude = s.Longitude,
                Operating = s.Operating,
                TimeZone = s.TimeZone ?? "America/Vancouver",
                Source = StationSource.Iwls,
                Datum = PredictionDatum,
            }).ToList() ?? [];

        _cache.Set(cacheKey, allStations, TimeSpan.FromHours(24));
        return allStations;
    }

    public async Task<List<TideDataPoint>> GetTidePredictionsAsync(string stationId, DateTime from, DateTime to)
    {
        var cacheKey = $"tides_{stationId}_{from:yyyyMMdd}_{to:yyyyMMdd}";
        if (_cache.TryGetValue(cacheKey, out List<TideDataPoint>? cached))
            return cached!;

        // CHS API has a ~30-day max per request — chunk larger ranges
        const int chunkDays = 30;
        var dataPoints = new List<TideDataPoint>();
        var chunkStart = from;

        while (chunkStart < to)
        {
            var chunkEnd = chunkStart.AddDays(chunkDays);
            if (chunkEnd > to) chunkEnd = to;

            var fromStr = chunkStart.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");
            var toStr = chunkEnd.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");

            var url = $"stations/{stationId}/data?time-series-code=wlp&from={fromStr}&to={toStr}&resolution=FIFTEEN_MINUTES";
            var response = await RateLimitedGetAsync(url);
            var rawData = await response.Content.ReadFromJsonAsync<List<IwlsDataPoint>>(JsonOptions);

            if (rawData != null)
            {
                dataPoints.AddRange(rawData.Select(d => new TideDataPoint
                {
                    Timestamp = DateTime.SpecifyKind(d.EventDate, DateTimeKind.Utc),
                    Value = d.Value
                }));
            }

            chunkStart = chunkEnd;
        }

        _cache.Set(cacheKey, dataPoints, TimeSpan.FromHours(6));
        return dataPoints;
    }

    public async Task<List<TideDataPoint>> GetObservedWaterLevelAsync(string stationId, DateTime from, DateTime to)
    {
        var cacheKey = $"wlo_{stationId}_{from:yyyyMMddHHmm}_{to:yyyyMMddHHmm}";
        if (_cache.TryGetValue(cacheKey, out List<TideDataPoint>? cached))
            return cached!;

        var fromStr = from.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");
        var toStr = to.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");
        var url = $"stations/{stationId}/data?time-series-code=wlo&from={fromStr}&to={toStr}&resolution=FIFTEEN_MINUTES";

        var dataPoints = new List<TideDataPoint>();
        try
        {
            var response = await RateLimitedGetAsync(url);
            var rawData = await response.Content.ReadFromJsonAsync<List<IwlsDataPoint>>(JsonOptions);
            if (rawData != null)
            {
                dataPoints.AddRange(rawData.Select(d => new TideDataPoint
                {
                    Timestamp = DateTime.SpecifyKind(d.EventDate, DateTimeKind.Utc),
                    Value = d.Value
                }));
            }
        }
        catch (HttpRequestException ex)
        {
            // Not every station has a live gauge - callers fall back to predictions.
            _logger.LogDebug(ex, "No observed water level available for station {StationId}", stationId);
        }

        _cache.Set(cacheKey, dataPoints, TimeSpan.FromMinutes(5));
        return dataPoints;
    }

    private async Task<HttpResponseMessage> RateLimitedGetAsync(string url)
    {
        await _rateLimiter.WaitAsync();
        try
        {
            var elapsed = DateTime.UtcNow - _lastRequestTime;
            if (elapsed.TotalMilliseconds < 350)
            {
                await Task.Delay(350 - (int)elapsed.TotalMilliseconds);
            }

            _logger.LogDebug("IWLS API request: {Url}", url);
            var response = await _httpClient.GetAsync(url);
            _lastRequestTime = DateTime.UtcNow;
            response.EnsureSuccessStatusCode();
            return response;
        }
        finally
        {
            _rateLimiter.Release();
        }
    }

    // Internal DTOs matching the CHS IWLS API response shape
    private class IwlsStation
    {
        public string Id { get; set; } = string.Empty;
        public string Code { get; set; } = string.Empty;
        public string OfficialName { get; set; } = string.Empty;
        public double Latitude { get; set; }
        public double Longitude { get; set; }
        public bool Operating { get; set; }
        [JsonPropertyName("timezone")]
        public string? TimeZone { get; set; }
        public List<IwlsTimeSeries>? TimeSeries { get; set; }
    }

    private class IwlsTimeSeries
    {
        public string Code { get; set; } = string.Empty;
    }

    private class IwlsDataPoint
    {
        public DateTime EventDate { get; set; }
        public double Value { get; set; }
    }
}
