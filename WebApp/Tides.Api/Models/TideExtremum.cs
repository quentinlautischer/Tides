using System.Text.Json.Serialization;

namespace Tides.Api.Models;

/// <summary>
/// A tide turning point as the upstream authority publishes it.
/// Deliberately not a <see cref="TideDataPoint"/>: the true high or low almost never falls on a
/// 15-minute boundary, so these carry their own timestamps and are not indexes into the charted
/// prediction series. The chart draws the wave from the 15-minute series and these on top of it.
/// </summary>
public class TideExtremum
{
    public DateTime Timestamp { get; set; }
    public double Value { get; set; }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public TideExtremumKind Kind { get; set; }
}

public enum TideExtremumKind
{
    High,
    Low
}
