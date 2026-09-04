using Tides.Api.Models;

namespace Tides.Api.Services;

/// <summary>
/// Resolves a wildlife observation from an upstream catalogue. One implementation today
/// (<see cref="INaturalistService"/>), kept behind an interface for the same reason
/// <see cref="ITideDataSource"/> is: the controller shouldn't know whose API it is talking to.
/// </summary>
public interface IObservationLookup
{
    /// <summary>The observation, or null where the catalogue has no such record.</summary>
    Task<Observation?> GetObservationAsync(long id);
}
