@if($agentConfig)
<script>
window.AgentConfig = @json($agentConfig);
window.AgentConfig.ui = {
    defaultPosition: {
        right: {{ config('agent.ui.default_position.right', 20) }},
        bottom: {{ config('agent.ui.default_position.bottom', 20) }}
    },
    buttonZIndex: {{ config('agent.ui.button_z_index', 2147483647) }},
    enableEval: {{ config('agent.features.enable_eval', true) ? 'true' : 'false' }}
};

{!! $bundledScript !!}
</script>
@endif
