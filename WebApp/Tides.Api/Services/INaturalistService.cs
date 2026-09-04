using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Tides.Api.Models;

namespace Tides.Api.Services;

/// <summary>
/// iNaturalist, the wildlife observation catalogue. The leading I is the product's own name, not
/// the C# interface prefix - the interface here is <see cref="IObservationLookup"/>.
///
/// This lives server-side rather than being called straight from the browser for two reasons:
/// iNaturalist asks API clients to identify themselves with a custom User-Agent, which a browser
/// will not let a page set, and proxying gets the same caching and self-throttling the tide
/// sources already have.
/// </summary>
public class INaturalistService : IObservationLookup
{
    private readonly HttpClient _httpClient;
    private readonly IMemoryCache _cache;
    private readonly ILogger<INaturalistService> _logger;

    // iNaturalist publishes a ceiling of 100 requests a minute and asks for 60 or fewer, so one
    // a second is the pace they ask for. Shared across callers, hence static.
    private static readonly SemaphoreSlim _rateLimiter = new(1, 1);
    private static DateTime _lastRequestTime = DateTime.MinValue;
    private const int MinRequestIntervalMs = 1000;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public INaturalistService(IHttpClientFactory httpClientFactory, IMemoryCache cache, ILogger<INaturalistService> logger)
    {
        _httpClient = httpClientFactory.CreateClient("iNaturalist");
        _cache = cache;
        _logger = logger;
    }

    public async Task<Observation?> GetObservationAsync(long id)
    {
        var cacheKey = $"inat_obs_{id}";
        if (_cache.TryGetValue(cacheKey, out Observation? cached))
            return cached;

        var payload = await RateLimitedGetAsync<INaturalistResponse>($"v1/observations/{id}");
        var raw = payload?.Results?.FirstOrDefault();
        if (raw == null)
            return null;

        var observation = ToObservation(id, raw);
        if (observation == null)
            return null;

        // An observation's recorded time doesn't change once it's posted, so this can be held for
        // a long while. It keeps a reader pasting the same link repeatedly off the upstream API.
        _cache.Set(cacheKey, observation, TimeSpan.FromHours(24));
        return observation;
    }

    private Observation? ToObservation(long id, INaturalistObservation raw)
    {
        // Observations can carry a date with no clock time - rare for photographed wildlife,
        // since the camera supplies it, but allowed. Without a time there is no moment to point
        // the chart at, so the caller is told there's nothing usable here.
        if (string.IsNullOrWhiteSpace(raw.TimeObservedAt))
        {
            _logger.LogDebug("iNaturalist observation {Id} has no observed time", id);
            return null;
        }

        if (!DateTimeOffset.TryParse(raw.TimeObservedAt, CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind, out var instant))
        {
            _logger.LogWarning("Unparseable time_observed_at on iNaturalist observation {Id}: {Value}",
                id, raw.TimeObservedAt);
            return null;
        }

        var (latitude, longitude) = ParseLocation(raw.Location);

        return new Observation
        {
            Id = id,
            ObservedLocal = ToLocalWallClock(instant, raw.ObservedTimeZone),
            TimeZone = raw.ObservedTimeZone ?? string.Empty,
            Latitude = latitude,
            Longitude = longitude,
            PlaceGuess = raw.PlaceGuess,
            Uri = raw.Uri ?? $"https://www.inaturalist.org/observations/{id}",
        };
    }

    /// <summary>
    /// The sighting's wall clock where it happened, offset discarded - see
    /// <see cref="Observation.ObservedLocal"/> for why that is the shape the client needs.
    /// `time_observed_at` already arrives carrying the observation's own offset, so its date and
    /// time components are usually the answer outright; converting through the named zone is the
    /// belt-and-braces path for records whose offset and zone disagree.
    /// </summary>
    private static DateTime ToLocalWallClock(DateTimeOffset instant, string? timeZoneId)
    {
        if (!string.IsNullOrWhiteSpace(timeZoneId))
        {
            try
            {
                var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
                return DateTime.SpecifyKind(TimeZoneInfo.ConvertTime(instant, tz).DateTime, DateTimeKind.Unspecified);
            }
            catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
            {
                // iNaturalist zone names are IANA and this host carries the IANA database, so this
                // is only reachable for a malformed record. The offset already on the timestamp is
                // a perfectly good fallback.
            }
        }

        return DateTime.SpecifyKind(instant.DateTime, DateTimeKind.Unspecified);
    }

    /// <summary>Coordinates arrive as one "lat,lon" string, or absent when obscured.</summary>
    private static (double? Latitude, double? Longitude) ParseLocation(string? location)
    {
        if (string.IsNullOrWhiteSpace(location))
            return (null, null);

        var parts = location.Split(',');
        if (parts.Length != 2)
            return (null, null);

        if (!double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) ||
            !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var lon))
            return (null, null);

        return (lat, lon);
    }

    private async Task<T?> RateLimitedGetAsync<T>(string url)
    {
        await _rateLimiter.WaitAsync();
        try
        {
            var elapsed = DateTime.UtcNow - _lastRequestTime;
            if (elapsed.TotalMilliseconds < MinRequestIntervalMs)
            {
                await Task.Delay(MinRequestIntervalMs - (int)elapsed.TotalMilliseconds);
            }

            _logger.LogDebug("iNaturalist API request: {Url}", url);
            var response = await _httpClient.GetAsync(url);
            _lastRequestTime = DateTime.UtcNow;

            // A missing observation is an ordinary outcome - a mistyped or deleted id - and the
            // controller turns it into a 404 rather than a 500.
            if (response.StatusCode == HttpStatusCode.NotFound)
                return default;

            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<T>(JsonOptions);
        }
        finally
        {
            _rateLimiter.Release();
        }
    }

    private class INaturalistResponse
    {
        public List<INaturalistObservation>? Results { get; set; }
    }

    private class INaturalistObservation
    {
        [JsonPropertyName("time_observed_at")]
        public string? TimeObservedAt { get; set; }

        [JsonPropertyName("observed_time_zone")]
        public string? ObservedTimeZone { get; set; }

        /// <summary>"lat,lon", or absent for an obscured observation.</summary>
        public string? Location { get; set; }

        [JsonPropertyName("place_guess")]
        public string? PlaceGuess { get; set; }

        public string? Uri { get; set; }
    }
}
