using Tides.Api.Models;

namespace Tides.Api.Services;

/// <summary>
/// The single entry point controllers use for station data. Merges the station lists
/// from every <see cref="ITideDataSource"/> and routes data requests back to whichever
/// source owns the station.
/// </summary>
public interface ITideStationDirectory
{
    Task<List<Station>> GetAllStationsAsync();
    Task<List<Station>> SearchStationsAsync(string query);
    Task<Station?> GetStationByCodeAsync(string code);
    Task<List<TideDataPoint>> GetTidePredictionsAsync(Station station, DateTime from, DateTime to);
    Task<List<TideDataPoint>> GetObservedWaterLevelAsync(Station station, DateTime from, DateTime to);
}
