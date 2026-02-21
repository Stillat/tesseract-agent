<?php

declare(strict_types=1);

namespace Native\Agent;

use Native\Agent\Http\EndpointResolver;

class DiscoveryWriter
{
    /**
     * Get the path to the discovery file.
     */
    public function getDiscoveryPath(): string
    {
        return base_path('.tesseract/discovery.json');
    }

    /**
     * Write the asset discovery file.
     */
    public function write(): bool
    {
        $dir = dirname($this->getDiscoveryPath());

        if (! is_dir($dir)) {
            return false;
        }

        $data = [
            'script_url' => EndpointResolver::scriptUrl(),
            'prefix' => EndpointResolver::prefix(),
            'written_at' => now()->toIso8601String(),
        ];

        return (bool) file_put_contents(
            $this->getDiscoveryPath(),
            json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );
    }

    /**
     * Check if the discovery file should be updated.
     */
    public function shouldUpdate(): bool
    {
        $path = $this->getDiscoveryPath();

        if (! file_exists($path)) {
            return true;
        }

        $existing = json_decode(file_get_contents($path), true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            return true;
        }

        return ($existing['script_url'] ?? '') !== EndpointResolver::scriptUrl();
    }

    /**
     * Update the discovery file if needed.
     */
    public function updateIfNeeded(): bool
    {
        if ($this->shouldUpdate()) {
            return $this->write();
        }

        return false;
    }
}
