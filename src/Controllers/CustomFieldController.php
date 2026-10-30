<?php

declare(strict_types=1);

namespace AgriPass\Controllers;

use AgriPass\Core\AuditLog;
use AgriPass\Core\Auth;
use AgriPass\Core\Database;
use AgriPass\Core\HttpException;
use AgriPass\Core\Request;
use AgriPass\Core\Response;
use AgriPass\Services\EventContext;

final class CustomFieldController
{
    private const TYPES = ['text', 'number', 'select', 'checkbox'];

    public static function store(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        EventContext::assertEditable($event);

        $data = $request->validate([
            'field_label' => 'required',
            'field_type' => 'required',
            'field_options' => 'optional',
            'is_required' => 'optional',
        ]);

        if (!in_array($data['field_type'], self::TYPES, true)) {
            throw new HttpException(422, 'Validation failed.', ['field_type' => 'Must be one of: ' . implode(', ', self::TYPES) . '.']);
        }
        $options = $data['field_options'];
        if ($data['field_type'] === 'select') {
            if (!is_array($options) || $options === [] || array_filter($options, 'is_string') !== $options) {
                throw new HttpException(422, 'Validation failed.', ['field_options' => 'Select fields need a list of string options.']);
            }
            $options = array_values($options);
        } else {
            $options = null;
        }

        $id = Database::insert(
            'INSERT INTO event_custom_fields (event_id, field_label, field_type, field_options, is_required) VALUES (?, ?, ?, ?, ?)',
            [$event['event_id'], $data['field_label'], $data['field_type'], $options === null ? null : json_encode($options), $data['is_required'] ? 1 : 0],
        );
        AuditLog::record($user['user_id'], 'custom_field.create', 'event_custom_field', $id);
        Response::json(['field' => Database::one('SELECT * FROM event_custom_fields WHERE field_id = ?', [$id])], 201);
    }

    public static function destroy(Request $request): void
    {
        $user = Auth::require(Auth::ADMINS);
        $event = EventContext::find($request->param('id'));
        EventContext::assertEditable($event);

        $deleted = Database::run(
            'DELETE FROM event_custom_fields WHERE field_id = ? AND event_id = ?',
            [$request->param('fieldId'), $event['event_id']],
        );
        if ($deleted === 0) {
            throw new HttpException(404, 'Custom field not found.');
        }
        AuditLog::record($user['user_id'], 'custom_field.delete', 'event_custom_field', $request->param('fieldId'));
        Response::json(['ok' => true]);
    }
}
