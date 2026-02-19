using Tides.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddMemoryCache();

builder.Services.AddHttpClient("IWLS", client =>
{
    client.BaseAddress = new Uri("https://api-iwls.dfo-mpo.gc.ca/api/v1/");
    client.DefaultRequestHeaders.Add("Accept", "application/json");
});

builder.Services.AddSingleton<IIwlsApiService, IwlsApiService>();
builder.Services.AddSingleton<ITideAnalysisService, TideAnalysisService>();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors();
app.MapControllers();

app.Run();
