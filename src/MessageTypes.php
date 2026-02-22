<?php

declare(strict_types=1);

namespace Native\Agent;

final class MessageTypes
{
    // Connection lifecycle
    public const HANDSHAKE = 'handshake';

    public const HANDSHAKE_ACK = 'handshake_ack';

    public const PING = 'ping';

    public const PONG = 'pong';

    // Request lifecycle (PHP -> Agent)
    public const REQUEST = 'request';

    // Database events (PHP -> Agent)
    public const QUERY = 'query';

    // Livewire events (PHP -> Agent)
    public const LIVEWIRE = 'livewire';

    // Navigation events (JS -> Agent)
    public const NAVIGATION = 'navigation';

    public const VISIBILITY = 'visibility';

    // Console events (JS -> Agent)
    public const CONSOLE = 'console';

    // Commands (Agent -> JS)
    public const COMMAND = 'command';

    public const COMMAND_RESPONSE = 'command_response';

    public const COMMAND_ACK = 'command_ack';

    // Generic messaging
    public const MESSAGE = 'message';

    public const BROADCAST = 'broadcast';

    public const ERROR = 'error';

    // Request actions
    public const ACTION_START = 'start';

    public const ACTION_END = 'end';

    // Livewire actions
    public const LW_MOUNT = 'mount';

    public const LW_HYDRATE = 'hydrate';

    public const LW_DEHYDRATE = 'dehydrate';

    public const LW_CALL = 'call';

    // Method calls and property changes (PHP/JS -> Agent)
    public const METHOD_CALL = 'method_call';

    public const PROPERTY_CHANGE = 'property_change';

    // Preview frame (JS -> Agent -> Dashboard)
    public const PREVIEW_FRAME = 'preview_frame';

    // Navigation actions
    public const NAV_PAGE_LOAD = 'page_load';

    public const NAV_PUSHSTATE = 'pushstate';

    public const NAV_REPLACESTATE = 'replacestate';

    public const NAV_POPSTATE = 'popstate';

    public const NAV_UNLOAD = 'unload';
}
