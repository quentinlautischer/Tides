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
}
