using Tides.Api.Models;

namespace Tides.Api.Services;

public class TideAnalysisService : ITideAnalysisService
{
    public LowestTideAnalysis Analyze(List<TideDataPoint> dataPoints, string timeZoneId)
    {
        if (dataPoints.Count == 0)
            return new LowestTideAnalysis();

        var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);

        var overallLowest = dataPoints.MinBy(d => d.Value)!;
        var overallLocalTime = TimeZoneInfo.ConvertTimeFromUtc(overallLowest.Timestamp.ToUniversalTime(), tz);

        var dailyLows = dataPoints
            .GroupBy(d => TimeZoneInfo.ConvertTimeFromUtc(d.Timestamp.ToUniversalTime(), tz).Date)
            .Select(g =>
            {
                var lowest = g.MinBy(d => d.Value)!;
                var localTime = TimeZoneInfo.ConvertTimeFromUtc(lowest.Timestamp.ToUniversalTime(), tz);
                return new DailyTideSummary
                {
                    Date = g.Key,
                    LowestValue = lowest.Value,
                    LowestTimestamp = localTime,
                    TimeOfDay = GetTimeOfDay(localTime.Hour)
                };
            })
            .OrderBy(d => d.LowestValue)
            .ToList();

        return new LowestTideAnalysis
        {
            LowestTide = new TideDataPoint
            {
                Timestamp = overallLocalTime,
                Value = overallLowest.Value
            },
            TimeOfDay = GetTimeOfDay(overallLocalTime.Hour),
            DailyLows = dailyLows
        };
    }

    private static string GetTimeOfDay(int hour) => hour switch
    {
        >= 5 and < 12 => "Morning",
        >= 12 and < 17 => "Afternoon",
        >= 17 and < 21 => "Evening",
        _ => "Night"
    };
}
