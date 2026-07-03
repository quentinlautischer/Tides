namespace Tides.Api.Models;

public class CurrentTideLevel
{
    public double Value { get; set; }
    public DateTime Timestamp { get; set; }
    public string Trend { get; set; } = "Steady";
    public string Source { get; set; } = "Predicted";
}
