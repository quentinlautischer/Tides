using Tides.Api.Models;

namespace Tides.Api.Services;

public interface IIwlsApiService
{
    Task<List<Station>> SearchStationsAsync(string query);
    Task<Station?> GetStationByCodeAsync(string code);
    Task<List<TideDataPoint>> GetTidePredictionsAsync(string stationId, DateTime from, DateTime to);
}
