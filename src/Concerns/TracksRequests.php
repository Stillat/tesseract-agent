<?php

declare(strict_types=1);

namespace Native\Agent\Concerns;

use Illuminate\Support\Str;

trait TracksRequests
{
    protected ?string $requestId = null;

    protected ?float $requestStartTime = null;

    protected int $queryCount = 0;

    /**
     * Start a new request lifecycle.
     */
    public function startRequest(): string
    {
        $this->requestId = 'req_'.Str::random(12);
        $this->requestStartTime = microtime(true);
        $this->queryCount = 0;
        $this->connectionFailed = false;

        return $this->requestId;
    }

    /**
     * Get the current request ID.
     */
    public function getRequestId(): ?string
    {
        return $this->requestId;
    }

    /**
     * Get request duration in milliseconds.
     */
    public function getRequestDuration(): ?float
    {
        if ($this->requestStartTime === null) {
            return null;
        }

        return round((microtime(true) - $this->requestStartTime) * 1000, 2);
    }

    /**
     * Increment the query count for this request.
     */
    public function incrementQueryCount(): void
    {
        $this->queryCount++;
    }

    /**
     * Get the query count for this request.
     */
    public function getQueryCount(): int
    {
        return $this->queryCount;
    }

    /**
     * End the current request lifecycle.
     */
    public function endRequest(): void
    {
        $this->flushQueue();

        $this->requestId = null;
        $this->requestStartTime = null;
        $this->queryCount = 0;
    }
}
