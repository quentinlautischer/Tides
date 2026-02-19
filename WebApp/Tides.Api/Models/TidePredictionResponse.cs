namespace Tides.Api.Models;

public class TidePredictionResponse
{
    public Station Station { get; set; } = new();
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public List<TideDataPoint> DataPoints { get; set; } = [];
}
