<?php

declare(strict_types=1);

namespace Native\src\Concerns;

use DateTimeInterface;
use Illuminate\Support\Str;
use JsonSerializable;
use Native\src\AgentConnector;
use Native\src\MessageTypes;
use Throwable;

trait RegistersLivewireListeners
{
    protected array $livewireTimers = [];

    /**
     * Map of runtime component IDs to stable IDs.
     */
    protected array $componentStableIds = [];

    /**
     * Track method calls by trace ID for capturing return values.
     */
    protected array $methodCallTraces = [];

    /**
     * Register Livewire lifecycle listeners.
     */
    protected function registerLivewireListeners(AgentConnector $connector): void
    {
        if (! class_exists(\Livewire\Livewire::class)) {
            return;
        }

        \Livewire\Livewire::listen('component.hydrate', function ($component, $context) use ($connector) {
            $componentId = $component->getId();

            // Start timing
            $traceId = 'lw_'.Str::random(8);
            $this->livewireTimers[$componentId] = $traceId;
            $this->livewireTimers["{$componentId}_start"] = microtime(true);

            $connector->sendLivewire(
                action: MessageTypes::LW_HYDRATE,
                component: $component->getName(),
                componentId: $componentId,
                extra: ['trace_id' => $traceId]
            );
        });

        \Livewire\Livewire::listen('component.dehydrate', function ($component, $context) use ($connector) {
            $componentId = $component->getId();

            // Get timing if available
            $traceId = $this->livewireTimers[$componentId] ?? null;
            $duration = null;

            if ($traceId && isset($this->livewireTimers["{$componentId}_start"])) {
                $duration = round((microtime(true) - $this->livewireTimers["{$componentId}_start"]) * 1000, 2);
                unset($this->livewireTimers[$componentId], $this->livewireTimers["{$componentId}_start"]);
            }

            $connector->sendLivewire(
                action: MessageTypes::LW_DEHYDRATE,
                component: $component->getName(),
                componentId: $componentId,
                extra: [
                    'trace_id' => $traceId,
                    'duration' => $duration,
                ]
            );

            $stableId = $this->resolveStableId($component);
            foreach ($this->methodCallTraces as $methodTraceId => $trace) {
                if ($trace['component_id'] === $componentId) {
                    $methodDuration = round((microtime(true) - $trace['start']) * 1000, 2);
                    $connector->sendMethodCall([
                        'action' => 'end',
                        'framework' => 'livewire',
                        'stable_id' => $stableId,
                        'runtime_id' => $componentId,
                        'method' => $trace['method'],
                        'trace_id' => $methodTraceId,
                        'duration_ms' => $methodDuration,
                        'return_value' => null, // Cannot capture return values in Livewire hooks
                    ]);
                    unset($this->methodCallTraces[$methodTraceId]);
                }
            }
        });

        \Livewire\Livewire::listen('mount', function ($component, $params) use ($connector) {
            $connector->sendLivewire(
                action: MessageTypes::LW_MOUNT,
                component: $component->getName(),
                componentId: $component->getId(),
                extra: ['params' => array_keys($params)]
            );
        });

        \Livewire\Livewire::listen('call', function ($component, $method, $params, $addEffect, $earlyReturn) use ($connector) {
            $componentId = $component->getId();

            $traceId = 'lw_call_'.Str::random(12);
            $this->livewireTimers["{$componentId}_{$method}"] = [
                'trace_id' => $traceId,
                'start' => microtime(true),
            ];

            $this->methodCallTraces[$traceId] = [
                'component_id' => $componentId,
                'component_name' => $component->getName(),
                'method' => $method,
                'start' => microtime(true),
            ];

            $connector->sendLivewire(
                action: MessageTypes::LW_CALL,
                component: $component->getName(),
                componentId: $componentId,
                extra: [
                    'method' => $method,
                    'params' => $this->formatLivewireParams($params),
                    'trace_id' => $traceId,
                ]
            );

            $connector->sendMethodCall([
                'action' => 'start',
                'framework' => 'livewire',
                'stable_id' => $this->resolveStableId($component),
                'runtime_id' => $componentId,
                'method' => $method,
                'params' => $this->serializeValue($params),
                'trace_id' => $traceId,
                'trigger_source' => 'livewire_call',
            ]);
        });

        \Livewire\Livewire::listen('update', function ($component, $propertyPath, $newValue) use ($connector) {
            $connector->sendPropertyChange([
                'framework' => 'livewire',
                'stable_id' => $this->resolveStableId($component),
                'runtime_id' => $component->getId(),
                'property_path' => $propertyPath,
                'new_value' => $this->serializeValue($newValue),
                'change_source' => 'livewire_update',
            ]);
        });
    }

    /**
     * Format Livewire params for display.
     */
    protected function formatLivewireParams(array $params): array
    {
        return array_map(function ($param) {
            if (is_object($param)) {
                return '['.get_class($param).']';
            }
            if (is_array($param)) {
                return '[array:'.count($param).']';
            }
            if (is_string($param) && strlen($param) > 50) {
                return substr($param, 0, 50).'...';
            }

            return $param;
        }, $params);
    }

    /**
     * Resolve stable ID for a Livewire component.
     */
    protected function resolveStableId($component): string
    {
        $componentId = $component->getId();
        $componentName = $component->getName();

        if (isset($this->componentStableIds[$componentId])) {
            return $this->componentStableIds[$componentId];
        }

        $stableId = "livewire:{$componentName}:".substr(md5($componentId), 0, 8);

        $this->componentStableIds[$componentId] = $stableId;

        return $stableId;
    }

    /**
     * Serialize a value for transmission, with size limits.
     * Limit: 10KB per value.
     */
    protected function serializeValue(mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }

        try {
            if (is_object($value)) {
                if ($value instanceof JsonSerializable) {
                    $value = $value->jsonSerialize();
                } elseif (method_exists($value, 'toArray')) {
                    $value = $value->toArray();
                } elseif ($value instanceof DateTimeInterface) {
                    return $value->format('c');
                } else {
                    return '['.get_class($value).']';
                }
            }

            $encoded = json_encode($value, JSON_THROW_ON_ERROR);

            if (strlen($encoded) > 10240) {
                if (is_array($value)) {
                    return ['_truncated' => true, '_size' => strlen($encoded), '_type' => 'array'];
                }

                return substr($encoded, 0, 10240).'... [truncated]';
            }

            return $value;
        } catch (Throwable $e) {
            return '[serialization error: '.$e->getMessage().']';
        }
    }
}
