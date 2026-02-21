<?php

namespace Native\src\Collectors;

use Illuminate\Support\Facades\DB;
use Throwable;

class AppInfoCollector extends BaseCollector
{
    public function getName(): string
    {
        return 'app_info';
    }

    public function getCategory(): string
    {
        return 'app';
    }

    public function getLabel(): string
    {
        return 'Application Info';
    }

    public function interval(): int
    {
        return 60;
    }

    public function shouldActivate(): bool
    {
        return true;
    }

    public function environments(): array
    {
        return ['*'];
    }

    public function collect(): array
    {
        $data = [
            'name' => config('app.name'),
            'environment' => app()->environment(),
            'debug' => config('app.debug'),
            'url' => config('app.url'),
            'timezone' => config('app.timezone'),
            'locale' => app()->getLocale(),
            'laravel_version' => app()->version(),
        ];

        // Database connection info
        try {
            $connection = DB::connection();
            $data['database'] = [
                'driver' => $connection->getDriverName(),
                'database' => $connection->getDatabaseName(),
                'connected' => true,
            ];
        } catch (Throwable $e) {
            $data['database'] = [
                'connected' => false,
                'error' => $e->getMessage(),
            ];
        }

        // Cache driver
        $data['cache'] = [
            'driver' => config('cache.default'),
            'store' => config('cache.stores.'.config('cache.default').'.driver', 'unknown'),
        ];

        // Session driver
        $data['session'] = [
            'driver' => config('session.driver'),
            'lifetime' => config('session.lifetime'),
        ];

        // Queue driver
        $data['queue'] = [
            'driver' => config('queue.default'),
        ];

        // Registered service providers count
        $data['providers'] = [
            'count' => count(app()->getLoadedProviders()),
        ];

        // Route info
        $routes = app('router')->getRoutes();
        $data['routes'] = [
            'count' => count($routes),
        ];

        // Loaded packages info
        $composerLock = base_path('composer.lock');
        if (file_exists($composerLock)) {
            try {
                $lock = json_decode(file_get_contents($composerLock), true);
                $data['packages'] = [
                    'count' => count($lock['packages'] ?? []),
                    'dev_count' => count($lock['packages-dev'] ?? []),
                ];
            } catch (Throwable $e) {
            }
        }

        return $data;
    }
}
