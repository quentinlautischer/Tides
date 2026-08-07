using Tides.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddMemoryCache();

builder.Services.AddHttpClient("IWLS", client =>
{
    client.BaseAddress = new Uri("https://api-iwls.dfo-mpo.gc.ca/api/v1/");
    client.DefaultRequestHeaders.Add("Accept", "application/json");
});

builder.Services.AddHttpClient("NOAA", client =>
{
    client.BaseAddress = new Uri("https://api.tidesandcurrents.noaa.gov/");
    client.DefaultRequestHeaders.Add("Accept", "application/json");
});

// Registration order sets the order stations appear in the merged list.
builder.Services.AddSingleton<ITideDataSource, IwlsApiService>();
builder.Services.AddSingleton<ITideDataSource, NoaaApiService>();
builder.Services.AddSingleton<ITideStationDirectory, TideStationDirectory>();
builder.Services.AddSingleton<ITideAnalysisService, TideAnalysisService>();

var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? [];

if (allowedOrigins.Length > 0)
{
    builder.Services.AddCors(options =>
    {
        options.AddDefaultPolicy(policy =>
        {
            policy.WithOrigins(allowedOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        });
    });
}

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

if (allowedOrigins.Length > 0)
{
    app.UseCors();
}

app.MapControllers();
app.MapFallbackToFile("index.html");

app.Run();
