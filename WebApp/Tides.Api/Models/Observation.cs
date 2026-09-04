namespace Tides.Api.Models;

/// <summary>
/// An iNaturalist observation, reduced to the parts that let the chart jump to it.
/// The use case is cross-referencing a wildlife sighting against the tide at the moment it was
/// made - "what was the water doing when I saw that bird".
/// </summary>
public class Observation
{
    public long Id { get; set; }

    /// <summary>
    /// When the sighting happened, as a wall clock reading at the place it happened, with no
    /// offset. That is deliberate and load-bearing: every timestamp this API emits is naive
    /// local time (see <see cref="TidePredictionResponse"/>), and the client compares them as
    /// such. An instant carrying an offset would land the chart marker off by the difference
    /// between the reader's zone and the station's.
    /// </summary>
    public DateTime ObservedLocal { get; set; }

    /// <summary>The IANA zone the sighting's wall clock belongs to, for display.</summary>
    public string TimeZone { get; set; } = string.Empty;

    /// <summary>Null where the observer obscured the location, which iNaturalist allows.</summary>
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public string? PlaceGuess { get; set; }

    /// <summary>Link back to the observation, so the app can credit where the data came from.</summary>
    public string Uri { get; set; } = string.Empty;
}
