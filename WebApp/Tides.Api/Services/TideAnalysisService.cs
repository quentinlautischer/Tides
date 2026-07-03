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

    public CurrentTideLevel? ComputeCurrentLevel(List<TideDataPoint> dataPoints, DateTime now, string timeZoneId, string source)
    {
        if (dataPoints.Count == 0)
            return null;

        var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        var sorted = dataPoints.OrderBy(d => d.Timestamp).ToList();

        if (source == "Observed")
        {
            var latest = sorted[^1];
            var trend = sorted.Count >= 2 ? GetTrend(sorted[^2].Value, latest.Value) : "Steady";
            return new CurrentTideLevel
            {
                Value = latest.Value,
                Timestamp = TimeZoneInfo.ConvertTimeFromUtc(latest.Timestamp, tz),
                Trend = trend,
                Source = source
            };
        }

        // Predicted: interpolate the value at `now` between the two bracketing points.
        TideDataPoint? beforePoint = sorted.LastOrDefault(d => d.Timestamp <= now);
        TideDataPoint? afterPoint = sorted.FirstOrDefault(d => d.Timestamp > now);

        if (beforePoint == null && afterPoint == null)
            return null;

        var before = beforePoint ?? afterPoint!;
        var after = afterPoint ?? beforePoint!;

        var value = before.Timestamp == after.Timestamp
            ? before.Value
            : before.Value + (after.Value - before.Value) * ((now - before.Timestamp).TotalSeconds / (after.Timestamp - before.Timestamp).TotalSeconds);

        return new CurrentTideLevel
        {
            Value = value,
            Timestamp = TimeZoneInfo.ConvertTimeFromUtc(now, tz),
            Trend = GetTrend(before.Value, after.Value),
            Source = source
        };
    }

    private static string GetTrend(double previous, double current)
    {
        const double epsilon = 0.01;
        if (current - previous > epsilon) return "Rising";
        if (previous - current > epsilon) return "Falling";
        return "Steady";
    }
}
