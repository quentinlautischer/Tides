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
}
