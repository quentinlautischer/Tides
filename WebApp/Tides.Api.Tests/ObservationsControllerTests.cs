using Microsoft.AspNetCore.Mvc;
using Tides.Api.Controllers;
using Tides.Api.Models;
using Tides.Api.Services;

namespace Tides.Api.Tests;

/// <summary>
/// The reference a reader pastes. Whatever iNaturalist put in their address bar should work, and
/// anything that isn't a reference at all should be turned away here rather than costing an
/// upstream request against a rate limit shared by every user of the app.
/// </summary>
public class ObservationsControllerTests
{
    private class RecordingLookup : IObservationLookup
    {
        public List<long> Requested { get; } = [];
        public Observation? Result { get; set; } = new() { Id = 397016222, ObservedLocal = new DateTime(2026, 9, 3, 7, 42, 0) };

        public Task<Observation?> GetObservationAsync(long id)
        {
            Requested.Add(id);
            return Task.FromResult(Result);
        }
    }

    [Theory]
    [InlineData("397016222")]
    [InlineData("  397016222  ")]
    [InlineData("https://www.inaturalist.org/observations/397016222")]
    [InlineData("https://inaturalist.org/observations/397016222")]
    [InlineData("https://www.inaturalist.org/observations/397016222#activity")]
    [InlineData("https://www.inaturalist.org/observations/397016222?locale=en")]
    public async Task Any_shape_of_reference_resolves_to_the_same_observation(string reference)
    {
        var lookup = new RecordingLookup();

        var result = await new ObservationsController(lookup).GetObservation(reference);

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal([397016222L], lookup.Requested);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("https://www.inaturalist.org/taxa/12345")]
    [InlineData("have a look at this bird")]
    [InlineData("0")]
    [InlineData("-5")]
    public async Task Something_that_isnt_a_reference_never_reaches_upstream(string? reference)
    {
        var lookup = new RecordingLookup();

        var result = await new ObservationsController(lookup).GetObservation(reference);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(lookup.Requested);
    }

    [Fact]
    public async Task A_reference_that_resolves_to_nothing_is_a_404()
    {
        var lookup = new RecordingLookup { Result = null };

        var result = await new ObservationsController(lookup).GetObservation("397016222");

        Assert.IsType<NotFoundObjectResult>(result);
    }
}
