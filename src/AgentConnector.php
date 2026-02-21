<?php

declare(strict_types=1);

namespace Native\src;

use Native\src\Concerns\DiscoversAgent;
use Native\src\Concerns\ExecutesCommands;
use Native\src\Concerns\ManagesConnection;
use Native\src\Concerns\SendsEvents;
use Native\src\Concerns\TracksRequests;

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
