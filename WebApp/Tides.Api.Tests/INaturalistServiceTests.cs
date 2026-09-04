using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Tides.Api.Models;
using Tides.Api.Services;
using Tides.Api.Tests.Fakes;

namespace Tides.Api.Tests;

/// <summary>
/// Resolving a sighting to the tide at the moment it was recorded.
///
/// The load-bearing part is the clock: everything this API emits is naive local time at the place
/// concerned, and the client feeds the sighting's date and time straight into the chart's jump-to
/// without converting. A moment that came back carrying an offset would put the marker off by the
/// reader's own offset - right-looking, and wrong by hours.
/// </summary>
public class INaturalistServiceTests
{
    private static INaturalistService Build(StubHttpMessageHandler handler) =>
        new(new StubHttpClientFactory(handler), new MemoryCache(new MemoryCacheOptions()),
            NullLogger<INaturalistService>.Instance);

    private static string ObservationJson(
        string? timeObservedAt = "2026-09-03T07:42:00-07:00",
        string? zone = "America/Vancouver",
        string? location = "49.2734,-123.1553",
        string? placeGuess = "Kitsilano Beach, Vancouver, BC") =>
        $$"""
        {
          "results": [
            {
              "time_observed_at": {{Json(timeObservedAt)}},
              "observed_time_zone": {{Json(zone)}},
              "location": {{Json(location)}},
              "place_guess": {{Json(placeGuess)}},
              "uri": "https://www.inaturalist.org/observations/397016222"
            }
          ]
        }
        """;

    private static string Json(string? value) => value == null ? "null" : $"\"{value}\"";

    [Fact]
    public async Task The_sighting_time_is_the_wall_clock_where_it_happened()
    {
        var handler = new StubHttpMessageHandler().RespondsTo("observations/1", ObservationJson());

        var observation = await Build(handler).GetObservationAsync(1);

        Assert.NotNull(observation);
        Assert.Equal(new DateTime(2026, 9, 3, 7, 42, 0), observation.ObservedLocal);
        Assert.Equal("America/Vancouver", observation.TimeZone);
    }

    [Fact]
    public async Task The_sighting_time_carries_no_offset()
    {
        // Unspecified, not Utc and not Local: the client splits this into bare date and time
        // components, so anything that would serialise with a trailing Z or an offset lands the
        // chart marker in the wrong place.
        var handler = new StubHttpMessageHandler().RespondsTo("observations/2", ObservationJson());

        var observation = await Build(handler).GetObservationAsync(2);

        Assert.Equal(DateTimeKind.Unspecified, observation!.ObservedLocal.Kind);
    }

    [Fact]
    public async Task A_zone_away_from_the_offset_on_the_timestamp_resolves_through_the_zone()
    {
        // Same instant, written with a UTC offset. The sighting happened at 07:42 in Vancouver,
        // and that - not 14:42 - is the time to point the chart at.
        var handler = new StubHttpMessageHandler()
            .RespondsTo("observations/3", ObservationJson(timeObservedAt: "2026-09-03T14:42:00Z"));

        var observation = await Build(handler).GetObservationAsync(3);

        Assert.Equal(new DateTime(2026, 9, 3, 7, 42, 0), observation!.ObservedLocal);
    }

    [Fact]
    public async Task An_obscured_location_resolves_without_coordinates()
    {
        // iNaturalist lets an observer hide where a sighting was, and does it by omitting the
        // field. The sighting is still perfectly usable - there is just no station to suggest.
        var handler = new StubHttpMessageHandler()
            .RespondsTo("observations/4", ObservationJson(location: null, placeGuess: null));

        var observation = await Build(handler).GetObservationAsync(4);

        Assert.NotNull(observation);
        Assert.Null(observation.Latitude);
        Assert.Null(observation.Longitude);
        Assert.Equal(new DateTime(2026, 9, 3, 7, 42, 0), observation.ObservedLocal);
    }

    [Fact]
    public async Task Coordinates_come_through_as_published()
    {
        var handler = new StubHttpMessageHandler().RespondsTo("observations/5", ObservationJson());

        var observation = await Build(handler).GetObservationAsync(5);

        Assert.Equal(49.2734, observation!.Latitude);
        Assert.Equal(-123.1553, observation.Longitude);
        Assert.Equal("Kitsilano Beach, Vancouver, BC", observation.PlaceGuess);
    }

    [Fact]
    public async Task An_observation_with_only_a_date_is_no_use_and_says_so()
    {
        // A record with no clock time has no moment to point the chart at. Rare for photographed
        // wildlife, since the camera supplies it, but allowed.
        var handler = new StubHttpMessageHandler()
            .RespondsTo("observations/6", ObservationJson(timeObservedAt: null));

        Assert.Null(await Build(handler).GetObservationAsync(6));
    }

    [Fact]
    public async Task An_unknown_observation_is_not_an_error()
    {
        // A mistyped or deleted id is an ordinary outcome, and iNaturalist answers it with an
        // empty results array rather than a status code.
        var handler = new StubHttpMessageHandler().RespondsTo("observations/7", """{ "results": [] }""");

        Assert.Null(await Build(handler).GetObservationAsync(7));
    }

    [Fact]
    public async Task A_second_lookup_of_the_same_sighting_costs_no_upstream_request()
    {
        // When a sighting happened doesn't change once it's posted, and iNaturalist asks callers
        // to stay under a request a second.
        var handler = new StubHttpMessageHandler().RespondsTo("observations/8", ObservationJson());
        var service = Build(handler);

        var first = await service.GetObservationAsync(8);
        var second = await service.GetObservationAsync(8);

        Assert.Single(handler.Requests);
        Assert.Equal(first!.ObservedLocal, second!.ObservedLocal);
    }
}
