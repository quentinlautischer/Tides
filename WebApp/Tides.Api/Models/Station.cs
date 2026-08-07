using System.Text.Json.Serialization;

namespace Tides.Api.Models;

public class Station
{
    public string Id { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string OfficialName { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public bool Operating { get; set; }
    public string TimeZone { get; set; } = string.Empty;

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public StationSource Source { get; set; }

    /// <summary>
    /// The vertical datum heights are measured from. Canada and the US use different
    /// ones, so a "below 0.5m" threshold does not mean the same thing on both sides of
    /// the border - the UI shows this so the numbers can be read correctly.
    /// </summary>
    public string Datum { get; set; } = string.Empty;
}
