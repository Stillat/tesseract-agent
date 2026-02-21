<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Environments
    |--------------------------------------------------------------------------
    |
    | The environments in which the Agent should be active.
    | By default, only active in 'local' environment.
    |
    */
    'environments' => ['*'],

    /*
    |--------------------------------------------------------------------------
    | Callback Host
    |--------------------------------------------------------------------------
    |
    | The host where the Agent desktop app is running. If null, the agent
    | will attempt to auto-detect based on the request.
    |
    */
    'callback_host' => null,

    /*
    |--------------------------------------------------------------------------
    | Route Prefix
    |--------------------------------------------------------------------------
    |
    | The URL prefix for Agent endpoints.
    |
    */
    'route_prefix' => '/_agent',

    /*
    |--------------------------------------------------------------------------
    | Pairing Path
    |--------------------------------------------------------------------------
    |
    | Relative path to the pairing configuration file.
    |
    */
    'pairing_path' => '.tesseract/pairing.json',

    /*
    |--------------------------------------------------------------------------
    | App ID Path
    |--------------------------------------------------------------------------
    |
    | Relative path to store the app identifier.
    |
    */
    'app_id_path' => 'agent/app_id',

    /*
    |--------------------------------------------------------------------------
    | WebSocket Timeout
    |--------------------------------------------------------------------------
    |
    | Timeout in seconds for WebSocket connections.
    |
    */
    'websocket_timeout' => 1,

    /*
    |--------------------------------------------------------------------------
    | Features
    |--------------------------------------------------------------------------
    |
    | Enable or disable specific Agent features.
    |
    */
    'features' => [
        'component_tracking' => true,
        'request_tracking' => true,
        'query_tracking' => true,
        'livewire_support' => true,
        'collectors' => true,
        'enable_eval' => true,
        'auto_inject_scripts' => true,
    ],

    /*
    |--------------------------------------------------------------------------
    | UI Configuration
    |--------------------------------------------------------------------------
    |
    | Configuration for the Agent debug button UI.
    |
    */
    'ui' => [
        'default_position' => [
            'right' => 20,
            'bottom' => 20,
        ],
        'button_z_index' => 2147483647,
    ],
];
