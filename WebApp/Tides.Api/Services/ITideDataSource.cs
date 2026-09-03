using Tides.Api.Models;

namespace Tides.Api.Services;

/// <summary>
/// One upstream tide authority. Each implementation owns a disjoint set of stations
/// and knows how to fetch predictions and observations for them. <see cref="ITideStationDirectory"/>
/// merges the sources and routes each request to the one that owns the station.
/// </summary>
public interface ITideDataSource
{
    StationSource Source { get; }

    /// <summary>Every station this source can actually serve predictions for.</summary>
    Task<List<Station>> GetAllStationsAsync();

    Task<List<TideDataPoint>> GetTidePredictionsAsync(string stationId, DateTime from, DateTime to);

    /// <summary>
    /// The high/low turning points the authority publishes for this range, on their own
    /// timestamps. Empty where the station carries no high/low series, in which case callers
    /// fall back to deriving them from the prediction series.
    /// </summary>
    Task<List<TideExtremum>> GetTideExtremaAsync(string stationId, DateTime from, DateTime to);

    /// <summary>Live gauge readings, or an empty list where the station has no gauge.</summary>
    Task<List<TideDataPoint>> GetObservedWaterLevelAsync(string stationId, DateTime from, DateTime to);
}
