using Tides.Api.Models;
using Tides.Api.Services;

namespace Tides.Api.Tests.Fakes;

/// <summary>
/// A directory holding one station and one canned series, standing in for whichever upstream
/// authority owns it. Records the window it was asked for, since half of what the controller
/// does is work out that window from the dates the client sent.
/// </summary>
public class FakeStationDirectory : ITideStationDirectory
{
    private readonly Station _station;
    private readonly List<TideDataPoint> _points;
    private readonly List<TideExtremum> _extrema;

    public DateTime RequestedFromUtc { get; private set; }
    public DateTime RequestedToUtc { get; private set; }

    public FakeStationDirectory(Station station, List<TideDataPoint>? points = null, List<TideExtremum>? extrema = null)
    {
        _station = station;
        _points = points ?? [];
        _extrema = extrema ?? [];
    }

    public Task<List<Station>> GetAllStationsAsync() => Task.FromResult(new List<Station> { _station });
    public Task<List<Station>> SearchStationsAsync(string query) => Task.FromResult(new List<Station> { _station });

    public Task<Station?> GetStationByCodeAsync(string code) =>
        Task.FromResult(code == _station.Code ? _station : null);

    public Task<List<TideDataPoint>> GetTidePredictionsAsync(Station station, DateTime from, DateTime to)
    {
        RequestedFromUtc = from;
        RequestedToUtc = to;
        return Task.FromResult(_points);
    }

    public Task<List<TideExtremum>> GetTideExtremaAsync(Station station, DateTime from, DateTime to) =>
        Task.FromResult(_extrema);

    public Task<List<TideDataPoint>> GetObservedWaterLevelAsync(Station station, DateTime from, DateTime to) =>
        Task.FromResult(new List<TideDataPoint>());
}
