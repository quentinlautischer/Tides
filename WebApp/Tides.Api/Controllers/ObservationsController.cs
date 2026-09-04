using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Tides.Api.Services;

namespace Tides.Api.Controllers;

[ApiController]
[Route("api/observations")]
public partial class ObservationsController : ControllerBase
{
    private readonly IObservationLookup _observations;

    public ObservationsController(IObservationLookup observations)
    {
        _observations = observations;
    }

    /// <summary>
    /// Resolves an iNaturalist observation to the moment and place it was recorded, so the chart
    /// can jump to the tide at that minute.
    ///
    /// Takes whatever the reader has to hand - the observation URL straight out of the address
    /// bar, or the bare id. The reference is a query parameter rather than a route segment
    /// because a pasted URL contains slashes of its own.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetObservation([FromQuery] string? reference)
    {
        if (!TryParseObservationId(reference, out var id))
        {
            return BadRequest(new
            {
                error = "Provide an iNaturalist observation URL or id, e.g. " +
                        "https://www.inaturalist.org/observations/397016222 or 397016222."
            });
        }

        var observation = await _observations.GetObservationAsync(id);
        if (observation == null)
        {
            return NotFound(new
            {
                error = $"No iNaturalist observation with a recorded time was found for id {id}."
            });
        }

        return Ok(observation);
    }

    /// <summary>
    /// Pulls the id out of a bare number or any iNaturalist observation URL. Anything else is
    /// rejected here rather than being forwarded upstream, so a stray paste costs no request.
    /// </summary>
    private static bool TryParseObservationId(string? reference, out long id)
    {
        id = 0;
        if (string.IsNullOrWhiteSpace(reference))
            return false;

        var trimmed = reference.Trim();

        if (long.TryParse(trimmed, out id))
            return id > 0;

        var match = ObservationUrlPattern().Match(trimmed);
        return match.Success && long.TryParse(match.Groups[1].Value, out id) && id > 0;
    }

    [GeneratedRegex(@"observations/(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex ObservationUrlPattern();
}
