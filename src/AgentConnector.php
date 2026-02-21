<?php

declare(strict_types=1);

namespace Native\Agent;

use Native\Agent\Concerns\DiscoversAgent;
use Native\Agent\Concerns\ExecutesCommands;
use Native\Agent\Concerns\ManagesConnection;
use Native\Agent\Concerns\SendsEvents;
use Native\Agent\Concerns\TracksRequests;

class AgentConnector
{
    use DiscoversAgent;
    use ExecutesCommands;
    use ManagesConnection;
    use SendsEvents;
    use TracksRequests;

    public function __destruct()
    {
        $this->disconnect();
    }
}
