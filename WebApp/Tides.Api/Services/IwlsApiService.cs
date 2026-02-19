using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Tides.Api.Models;

namespace Tides.Api.Services;

public class IwlsApiService : IIwlsApiService
{
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

    public async Task<List<Station>> SearchStationsAsync(string query)
    {
        var cacheKey = $"stations_all";
        if (!_cache.TryGetValue(cacheKey, out List<Station>? allStations))
        {
            var response = await RateLimitedGetAsync("stations");
            var rawStations = await response.Content.ReadFromJsonAsync<List<IwlsStation>>(JsonOptions);
            allStations = rawStations?.Select(s => new Station
            {
                Id = s.Id,
                Code = s.Code,
                OfficialName = s.OfficialName,
                Latitude = s.Latitude,
                Longitude = s.Longitude,
                Operating = s.Operating,
                TimeZone = s.TimeZone ?? "America/Vancouver"
            }).ToList() ?? [];

            _cache.Set(cacheKey, allStations, TimeSpan.FromHours(24));
        }

        if (string.IsNullOrWhiteSpace(query))
            return allStations!.Take(20).ToList();

        return allStations!
            .Where(s => s.OfficialName.Contains(query, StringComparison.OrdinalIgnoreCase)
                     || s.Code.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Take(20)
            .ToList();
    }

    public async Task<Station?> GetStationByCodeAsync(string code)
    {
        var cacheKey = $"station_{code}";
        if (_cache.TryGetValue(cacheKey, out Station? station))
            return station;

        var response = await RateLimitedGetAsync($"stations?code={code}");
        var stations = await response.Content.ReadFromJsonAsync<List<IwlsStation>>(JsonOptions);
        var raw = stations?.FirstOrDefault();
        if (raw == null) return null;

        station = new Station
        {
            Id = raw.Id,
            Code = raw.Code,
            OfficialName = raw.OfficialName,
            Latitude = raw.Latitude,
            Longitude = raw.Longitude,
            Operating = raw.Operating,
            TimeZone = raw.TimeZone ?? "America/Vancouver"
        };

        _cache.Set(cacheKey, station, TimeSpan.FromHours(24));
        return station;
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
                    Timestamp = d.EventDate,
                    Value = d.Value
                }));
            }

            chunkStart = chunkEnd;
        }

        _cache.Set(cacheKey, dataPoints, TimeSpan.FromHours(6));
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
    }

    private class IwlsDataPoint
    {
        public DateTime EventDate { get; set; }
        public double Value { get; set; }
    }
}
