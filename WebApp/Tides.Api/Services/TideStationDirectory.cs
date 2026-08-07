using Tides.Api.Models;

namespace Tides.Api.Services;

public class TideStationDirectory : ITideStationDirectory
{
    private const int MaxSearchResults = 20;

    private readonly Dictionary<StationSource, ITideDataSource> _sources;

    public TideStationDirectory(IEnumerable<ITideDataSource> sources)
    {
        _sources = sources.ToDictionary(s => s.Source);
    }

    public async Task<List<Station>> GetAllStationsAsync()
    {
        var lists = await Task.WhenAll(_sources.Values.Select(s => s.GetAllStationsAsync()));
        return lists.SelectMany(l => l).ToList();
    }

    public async Task<List<Station>> SearchStationsAsync(string query)
    {
        var all = await GetAllStationsAsync();

        if (string.IsNullOrWhiteSpace(query))
            return all.Take(MaxSearchResults).ToList();

        // Rank before truncating. Concatenating the sources and taking the first 20 matches
        // would let one country's stations crowd the other's out of the results entirely.
        return all
            .Select(s => new { Station = s, Rank = MatchRank(s, query) })
            .Where(x => x.Rank < int.MaxValue)
            .OrderBy(x => x.Rank)
            .ThenBy(x => x.Station.OfficialName, StringComparer.OrdinalIgnoreCase)
            .Take(MaxSearchResults)
            .Select(x => x.Station)
            .ToList();
    }

    private static int MatchRank(Station station, string query)
    {
        if (station.Code.Equals(query, StringComparison.OrdinalIgnoreCase)) return 0;
        if (station.OfficialName.StartsWith(query, StringComparison.OrdinalIgnoreCase)) return 1;
        if (station.OfficialName.Contains(query, StringComparison.OrdinalIgnoreCase)) return 2;
        if (station.Code.Contains(query, StringComparison.OrdinalIgnoreCase)) return 3;
        return int.MaxValue;
    }

    public async Task<Station?> GetStationByCodeAsync(string code)
    {
        var all = await GetAllStationsAsync();
        return all.FirstOrDefault(s => s.Code.Equals(code, StringComparison.OrdinalIgnoreCase));
    }

    public Task<List<TideDataPoint>> GetTidePredictionsAsync(Station station, DateTime from, DateTime to)
        => SourceFor(station).GetTidePredictionsAsync(station.Id, from, to);

    public Task<List<TideDataPoint>> GetObservedWaterLevelAsync(Station station, DateTime from, DateTime to)
        => SourceFor(station).GetObservedWaterLevelAsync(station.Id, from, to);

    private ITideDataSource SourceFor(Station station)
    {
        if (!_sources.TryGetValue(station.Source, out var source))
            throw new InvalidOperationException($"No registered data source for {station.Source}.");

        return source;
    }
}
