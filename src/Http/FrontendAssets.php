<?php

declare(strict_types=1);

namespace Native\src\Http;

use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Route;
use Native\src\AgentConnector;

class FrontendAssets
{
    /**
     * Register routes for serving JS assets.
     */
    public static function registerRoutes(): void
    {
        Route::get(EndpointResolver::scriptPath(), [static::class, 'serveScript'])
            ->name('agent.script');

        Route::get(EndpointResolver::prefix().'/agent.bundle.js', [static::class, 'serveBundledScript'])
            ->name('agent.bundle');

        Route::post('/_agent/command', function (Request $request) {
            $connector = app(AgentConnector::class);
            $command = $request->input('command');
            $commandId = $request->input('command_id');
            $params = $request->input('params', []);

            $result = $connector->executeCommand($command, $params);

            return response()->json([
                'command_id' => $commandId,
                'success' => ! isset($result['error']),
                'data' => $result,
            ]);
        })->withoutMiddleware([VerifyCsrfToken::class])
            ->name('agent.command');
    }

    /**
     * Serve the main entry script.
     */
    public static function serveScript(): Response
    {
        return static::serveBundledScript();
    }

    /**
     * Get the filesystem path to the pre-built bundle.
     */
    protected static function getBundlePath(): string
    {
        return dirname(__DIR__, 2).'/dist/agent.bundle.js';
    }

    public static function serveBundledScript(): Response
    {
        $bundled = static::getBundledContent();
        $cacheControl = app()->isProduction()
            ? 'public, max-age=31536000'
            : 'no-cache, must-revalidate';

        return response($bundled, 200, [
            'Content-Type' => 'application/javascript; charset=utf-8',
            'Cache-Control' => $cacheControl,
        ]);
    }

    public static function getBundledContent(): string
    {
        $bundlePath = static::getBundlePath();

        if (file_exists($bundlePath)) {
            return file_get_contents($bundlePath);
        }

        return '// Agent bundle not found. Run: cd agent && npm run build';
    }
}
