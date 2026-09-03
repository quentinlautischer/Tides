using Tides.Api.Models;

namespace Tides.Api.Services;

public interface ITideAnalysisService
{
    /// <summary>
    /// Ranks the low tides in a range. Takes the published turning points rather than the
    /// 15-minute prediction series so the times it reports are the real ones, not the nearest
    /// quarter hour.
    /// </summary>
    LowestTideAnalysis Analyze(List<TideExtremum> extrema, string timeZoneId);

    /// <summary>
    /// Turning points recovered from the 15-minute series, for stations whose authority
    /// publishes no high/low series. Accurate to the sampling interval, no better.
    /// </summary>
    List<TideExtremum> DeriveExtrema(List<TideDataPoint> dataPoints);
    CurrentTideLevel? ComputeCurrentLevel(List<TideDataPoint> dataPoints, DateTime now, string timeZoneId, string source);
}
