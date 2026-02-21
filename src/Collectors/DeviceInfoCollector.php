<?php

namespace Native\src\Collectors;

use Native\Laravel\Facades\System;
use Throwable;

class DeviceInfoCollector extends BaseCollector
{
    public function getName(): string
    {
        return 'device_info';
    }

    public function getCategory(): string
    {
        return 'device';
    }

    public function getLabel(): string
    {
        return 'Device Info';
    }

    public function interval(): int
    {
        return 30;
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
            'platform' => PHP_OS_FAMILY,
            'os' => PHP_OS,
            'php_version' => PHP_VERSION,
            'laravel_version' => app()->version(),
            'hostname' => gethostname(),
            'server_software' => $_SERVER['SERVER_SOFTWARE'] ?? null,
        ];

        try {
            $data['nativephp'] = [
                'platform' => System::platform(),
                'arch' => System::arch(),
                'hostname' => System::hostname(),
                'memory' => System::memory(),
                'uptime' => System::uptime(),
            ];
        } catch (Throwable $e) {
            $data['nativephp_error'] = $e->getMessage();
        }

        // Add memory usage info
        $data['memory'] = [
            'current' => memory_get_usage(true),
            'peak' => memory_get_peak_usage(true),
            'limit' => $this->parseMemoryLimit(ini_get('memory_limit')),
        ];

        // Add disk info if available
        $appPath = base_path();
        if (is_dir($appPath)) {
            $data['disk'] = [
                'free' => disk_free_space($appPath),
                'total' => disk_total_space($appPath),
            ];
        }

        // Add CPU load (Unix only)
        if (function_exists('sys_getloadavg')) {
            $data['load_average'] = sys_getloadavg();
        }

        return $data;
    }

    /**
     * Parse PHP memory limit string to bytes.
     */
    protected function parseMemoryLimit(string $limit): ?int
    {
        if ($limit === '-1') {
            return null;
        }

        $limit = strtolower(trim($limit));
        $last = substr($limit, -1);
        $value = (int) $limit;

        switch ($last) {
            case 'g':
                $value *= 1024 * 1024 * 1024;
                break;
            case 'm':
                $value *= 1024 * 1024;
                break;
            case 'k':
                $value *= 1024;
                break;
        }

        return $value;
    }
}
