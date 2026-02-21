<?php

declare(strict_types=1);

namespace Native\src\Middleware;

use Closure;
use Illuminate\Http\Request;
use Native\src\AgentConnector;
use Symfony\Component\HttpFoundation\Response;

class AgentMiddleware
{
    public function __construct(
        protected AgentConnector $connector
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->connector->isAvailable()) {
            return $next($request);
        }

        $this->connector->startRequest();

        $this->connector->sendRequestStart(
            method: $request->method(),
            path: $request->path(),
            isLivewire: $request->hasHeader('X-Livewire')
        );

        $response = $next($request);

        $this->connector->sendRequestEnd($response->getStatusCode());
        $this->connector->processIncomingCommands();
        $this->connector->endRequest();

        return $response;
    }
}
