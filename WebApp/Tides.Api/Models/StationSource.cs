namespace Tides.Api.Models;

/// <summary>
/// The upstream authority a station's data comes from. Each source publishes its own
/// station list, and the two lists are disjoint, so this also decides which service
/// handles a prediction request.
/// </summary>
public enum StationSource
{
    /// <summary>Fisheries and Oceans Canada, Integrated Water Level System.</summary>
    Iwls,

    /// <summary>NOAA Center for Operational Oceanographic Products and Services.</summary>
    Noaa
}
