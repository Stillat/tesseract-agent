<?php

declare(strict_types=1);

namespace Native\Agent\Concerns;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Native\Agent\Http\EndpointResolver;
use Throwable;

trait DiscoversAgent
{
    protected ?array $config = null;

    protected ?string $appId = null;

    protected static ?array $pairingCache = null;

    protected static ?int $pairingMtime = null;

    /**
     * Get the origin URL to advertise for callbacks.
     */
    protected function getCallbackOrigin(): string
    {
        $configuredHost = config('agent.callback_host');

        if ($configuredHost) {
            return rtrim($configuredHost, '/');
        }

        // Fall back to request host
        try {
            return request()->getSchemeAndHttpHost();
        } catch (Throwable $e) {
            return config('app.url', 'http://localhost');
        }
    }

    /**
     * @param  bool  $forceRefresh  Force re-reading the pairing file (checks mtime first)
     */
    public function discover(bool $forceRefresh = false): ?array
    {
        if ($this->config !== null && ! $forceRefresh) {
            return $this->config;
        }

        $pairingPath = $this->getPairingPath();

        Log::debug('[Agent] Discovering pairing file at: '.$pairingPath);

        if (! file_exists($pairingPath)) {
            Log::debug('[Agent] Pairing file not found');
            $this->config = null;
            self::$pairingCache = null;
            self::$pairingMtime = null;

            return null;
        }

        $currentMtime = filemtime($pairingPath);
        if (self::$pairingCache !== null && self::$pairingMtime === $currentMtime) {
            $this->config = self::$pairingCache;

            return $this->config;
        }

        // File changed or first read - parse it
        $content = file_get_contents($pairingPath);
        $data = json_decode($content, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            $this->config = null;

            return null;
        }

        if (! isset($data['ws_url']) || ! isset($data['project_id'])) {
            $this->config = null;

            return null;
        }

        $this->config = $data;
        self::$pairingCache = $data;
        self::$pairingMtime = $currentMtime;

        Log::debug('[Agent] Discovered pairing: ws_url='.$this->config['ws_url'].', project_id='.$data['project_id']);

        return $this->config;
    }

    /**
     * Get the path to the pairing file.
     */
    public function getPairingPath(): string
    {
        $relativePath = config('agent.pairing_path', '.tesseract/pairing.json');

        return base_path($relativePath);
    }

    /**
     * Get the path to the app ID file.
     */
    protected function getAppIdPath(): string
    {
        $relativePath = config('agent.app_id_path', 'agent/app_id');

        return storage_path($relativePath);
    }

    /**
     * Check if Agent is available.
     */
    public function isAvailable(): bool
    {
        return $this->discover() !== null;
    }

    /**
     * Get the stable app ID (persisted across requests).
     */
    public function getAppId(): string
    {
        if ($this->appId !== null) {
            return $this->appId;
        }

        $appIdPath = $this->getAppIdPath();

        if (file_exists($appIdPath)) {
            $this->appId = trim(file_get_contents($appIdPath));

            return $this->appId;
        }

        // Generate and persist new app ID
        $this->appId = 'app_'.Str::random(16);

        $dir = dirname($appIdPath);
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        file_put_contents($appIdPath, $this->appId);

        return $this->appId;
    }

    /**
     * Get configuration for JavaScript injection.
     */
    public function getConfig(): ?array
    {
        // Force refresh to pick up pairing file changes
        $config = $this->discover(forceRefresh: true);

        if (! $config) {
            return null;
        }

        return [
            'ws_url' => $config['ws_url'],
            'project_id' => $config['project_id'],
            'app_id' => $this->getAppId(),
            'origin' => $this->getCallbackOrigin(),
            'app_info' => [
                'name' => config('app.name'),
                'laravel_version' => app()->version(),
                'php_version' => PHP_VERSION,
            ],
            'paths' => [
                'base' => base_path(),
                'resources' => resource_path(),
                'views' => resource_path('views'),
                'public' => public_path(),
                'storage' => storage_path(),
                'script_url' => EndpointResolver::scriptUrl(),
            ],
        ];
    }
}
