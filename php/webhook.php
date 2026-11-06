<?php
// webhook.php  (Chapter 6) - single-file Vapi server URL, PHP 8.0+.
// Point server.url at https://your-site.com/webhook.php
// Set VAPI_WEBHOOK_SECRET in the environment (or Apache SetEnv).

declare(strict_types=1);
header('Content-Type: application/json');

function reply(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

// 1. Verify the shared secret (Bearer or legacy x-vapi-secret).
$secret = getenv('VAPI_WEBHOOK_SECRET') ?: '';
if ($secret === '') {
    reply(500, ['error' => 'server not configured']);
}
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$bearer = str_starts_with($auth, 'Bearer ') ? substr($auth, 7) : '';
$legacy = $_SERVER['HTTP_X_VAPI_SECRET'] ?? '';
$ok = ($bearer !== '' && hash_equals($secret, $bearer))
    || ($legacy !== '' && hash_equals($secret, $legacy));
if (!$ok) {
    reply(401, ['error' => 'unauthorized']);
}

// 2. Parse the body.
$payload = json_decode(file_get_contents('php://input'), true);
$message = $payload['message'] ?? null;
$type = $message['type'] ?? '';
if ($type === '') {
    reply(400, ['error' => 'missing message.type']);
}
$callId = $message['call']['id'] ?? 'no-call-id';
error_log("[vapi] $type call=$callId");

// 3. Tiny JSON file store: data/<name>.json keyed by id.
function upsert(string $name, string $id, array $patch): void
{
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $file = "$dir/$name.json";
    $fh = fopen($file, 'c+');
    flock($fh, LOCK_EX); // PHP runs requests in parallel: lock.
    $raw = stream_get_contents($fh);
    $data = $raw ? json_decode($raw, true) : [];
    $now = gmdate('c');
    $prev = $data[$id] ?? ['id' => $id, 'createdAt' => $now];
    $data[$id] = array_merge($prev, $patch, ['updatedAt' => $now]);
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data, JSON_PRETTY_PRINT));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
}

// 4. Tool handlers: name => fn(array $args, array $message): string
$tools = [
    'getBusinessHours' => function (array $args, array $m): string {
        $tz = new DateTimeZone(getenv('BUSINESS_TZ') ?: 'UTC');
        $now = new DateTime('now', $tz);
        $day = $args['day'] ?? $now->format('l');
        if (in_array($day, ['Saturday', 'Sunday'], true)) {
            return "We are closed on $day. Weekday hours are "
                . 'Monday to Friday, 8 AM to 5 PM.';
        }
        return "On $day we are open 8 AM to 5 PM.";
    },
];

function flat(mixed $value): string
{
    $text = is_string($value) ? $value : json_encode($value);
    return trim(preg_replace('/\s*\n\s*/', ' ', (string) $text));
}

// 5. Route by message type.
switch ($type) {
    case 'tool-calls':
        $results = [];
        foreach ($message['toolCallList'] ?? [] as $tc) {
            $name = $tc['function']['name'] ?? '';
            $args = $tc['function']['arguments'] ?? [];
            if (is_string($args)) {
                $args = json_decode($args, true) ?: [];
            }
            $row = ['name' => $name, 'toolCallId' => $tc['id']];
            try {
                if (!isset($tools[$name])) {
                    throw new RuntimeException("Unknown tool: $name");
                }
                $row['result'] = flat($tools[$name]($args, $message));
            } catch (Throwable $e) {
                $row['error'] = flat($e->getMessage());
            }
            $results[] = $row;
        }
        reply(200, ['results' => $results]); // always HTTP 200

    case 'assistant-request':
        $id = getenv('INBOUND_ASSISTANT_ID') ?: '';
        reply(200, $id !== ''
            ? ['assistantId' => $id]
            : ['error' => 'Sorry, this line is not set up yet.']);

    case 'status-update':
        upsert('calls', $callId, ['status' => $message['status']]);
        reply(200, ['received' => true]);

    case 'end-of-call-report':
        $art = $message['artifact'] ?? [];
        $ana = $message['analysis'] ?? [];
        upsert('calls', $callId, [
            'status' => 'ended',
            'endedReason' => $message['endedReason'] ?? null,
            'cost' => $message['cost'] ?? null,
            'transcript' => $art['transcript'] ?? '',
            'recordingUrl' => $art['recordingUrl'] ?? null,
            'structuredOutputs' => $art['structuredOutputs'] ?? null,
            'summary' => $ana['summary'] ?? null,
        ]);
        reply(200, ['received' => true]);

    default:
        reply(200, ['received' => true]);
}
