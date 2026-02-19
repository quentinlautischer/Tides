namespace Tides.Api.Models;

public class LowestTideAnalysis
{
    public TideDataPoint LowestTide { get; set; } = new();
    public string TimeOfDay { get; set; } = string.Empty;
    public List<DailyTideSummary> DailyLows { get; set; } = [];
}

public class DailyTideSummary
{
    public DateTime Date { get; set; }
    public double LowestValue { get; set; }
    public DateTime LowestTimestamp { get; set; }
    public string TimeOfDay { get; set; } = string.Empty;
}
