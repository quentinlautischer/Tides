using Microsoft.AspNetCore.Mvc;
using Tides.Api.Services;

namespace Tides.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class StationsController : ControllerBase
{
    private readonly IIwlsApiService _iwlsService;

    public StationsController(IIwlsApiService iwlsService)
    {
        _iwlsService = iwlsService;
    }

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? search)
    {
        var stations = await _iwlsService.SearchStationsAsync(search ?? "");
        return Ok(stations);
    }

    // The map plots every station at once, so it needs the full list rather than the
    // top-20 slice that the search endpoint returns.
    [HttpGet("all")]
    public async Task<IActionResult> All()
    {
        var stations = await _iwlsService.GetAllStationsAsync();
        return Ok(stations);
    }
}
