namespace Tides.Api.Models;

public class TidePredictionResponse
{
    public Station Station { get; set; } = new();
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public List<TideDataPoint> DataPoints { get; set; } = [];

    /// <summary>
    /// The published high/low turning points across the same range, on their own timestamps
    /// rather than snapped to the 15-minute grid <see cref="DataPoints"/> uses.
    /// </summary>
    public List<TideExtremum> Extrema { get; set; } = [];
}
