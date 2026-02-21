<?php

declare(strict_types=1);

namespace Native\src;

class AgentConfig
{
    /**
     * WebSocket connection timeout in seconds.
     */
    public const WEBSOCKET_TIMEOUT = 1;

    /**
     * Timeout for checking incoming messages.
     */
    public const WEBSOCKET_RECEIVE_TIMEOUT = 0.1;

    /**
     * Maximum number of stack frames to capture for query caller detection.
     */
    public const STACK_TRACE_LIMIT = 20;

    /**
     * Maximum bytes to read per log chunk.
     */
    public const LOG_CHUNK_MAX_BYTES = 102400; // 100KB

    /**
     * Maximum lines to return per log response.
     */
    public const LOG_MAX_LINES = 500;

    /**
     * Maximum bytes to read from a file.
     */
    public const STORAGE_READ_MAX_BYTES = 102400; // 100KB

    /**
     * Maximum image size for base64 encoding.
     */
    public const STORAGE_IMAGE_MAX_SIZE = 5 * 1024 * 1024; // 5MB

    /**
     * Maximum size for serialized values.
     */
    public const SERIALIZATION_MAX_SIZE = 10240;

    /**
     * Maximum attribute value length for DOM serialization.
     */
    public const DOM_ATTR_MAX_LENGTH = 500;

    /**
     * Maximum text node length for DOM serialization.
     */
    public const DOM_TEXT_MAX_LENGTH = 200;

    /**
     * Initial DOM snapshot depth.
     * JavaScript: DomObserver.initialMaxDepth
     */
    public const DOM_INITIAL_MAX_DEPTH = 15;

    /**
     * Maximum DOM depth when expanded on demand.
     * JavaScript: DomObserver.expandedMaxDepth
     */
    public const DOM_EXPANDED_MAX_DEPTH = 50;

    /**
     * DOM mutation batch interval in milliseconds.
     * JavaScript: DomObserver.batchInterval
     */
    public const DOM_BATCH_INTERVAL_MS = 50;

    /**
     * Console message flush interval in milliseconds.
     * JavaScript: AgentConnector.consoleFlushInterval
     */
    public const CONSOLE_FLUSH_INTERVAL_MS = 100;

    /**
     * Console buffer maximum size before forced flush.
     * JavaScript: AgentConnector.consoleBufferMaxSize
     */
    public const CONSOLE_BUFFER_MAX_SIZE = 50;

    /**
     * Default button z-index.
     */
    public const BUTTON_Z_INDEX = 2147483647;

    /**
     * Default button position from the right edge in pixels.
     */
    public const BUTTON_DEFAULT_RIGHT = 20;

    /**
     * Default button position from the bottom edge in pixels.
     */
    public const BUTTON_DEFAULT_BOTTOM = 20;

    /**
     * Initial retry delay for WebSocket reconnection in milliseconds.
     */
    public const RECONNECT_INITIAL_DELAY_MS = 1000;

    /**
     * Maximum retry delay for WebSocket reconnection in milliseconds.
     */
    public const RECONNECT_MAX_DELAY_MS = 30000;

    /**
     * Default interval for AppInfoCollector in seconds.
     */
    public const COLLECTOR_APP_INFO_INTERVAL = 60;

    /**
     * Default interval for DeviceInfoCollector in seconds.
     */
    public const COLLECTOR_DEVICE_INFO_INTERVAL = 30;
}
