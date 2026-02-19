using Tides.Api.Models;

namespace Tides.Api.Services;

public interface ITideAnalysisService
{
    LowestTideAnalysis Analyze(List<TideDataPoint> dataPoints, string timeZoneId);
}
