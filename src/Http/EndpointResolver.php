<?php

declare(strict_types=1);

namespace Native\Agent\Http;

use Throwable;

class EndpointResolver
{
    public static function prefix(): string
    {
        return config('agent.route_prefix', '/_agent');
    }

    /**
     * Get the path for the main entry point script.
     */
    public static function scriptPath(): string
    {
        return static::prefix().'/agent.js';
    }

    /**
     * Get the path for a specific module.
     */
    public static function modulePath(string $module): string
    {
        return static::prefix().'/'.$module.'.js';
    }

    /**
     * Get the base URL, trying multiple sources for NativePHP compatibility.
     */
    public static function baseUrl(): string
    {
        try {
            $base = url('/');
            if ($base) {
                return rtrim($base, '/');
            }
        } catch (Throwable $e) {
            // URL generator not available, continue to fallback
        }

        // Fall back to config
        $appUrl = config('app.url');
        if ($appUrl) {
            return rtrim($appUrl, '/');
        }

        // Last resort fallback
        return 'http://localhost';
    }

    /**
     * Get the full URL for the main script (for discovery).
     */
    public static function scriptUrl(): string
    {
        return static::baseUrl().static::scriptPath();
    }

    /**
     * Get the path for the bundled script (iOS compatibility).
     */
    public static function bundledScriptPath(): string
    {
        return static::prefix().'/agent.bundle.js';
    }

    /**
     * Get the full URL for the bundled script.
     */
    public static function bundledScriptUrl(): string
    {
        return static::baseUrl().static::bundledScriptPath();
    }

    /**
     * Get the full URL for a specific module.
     */
    public static function moduleUrl(string $module): string
    {
        return static::baseUrl().static::modulePath($module);
    }
}
