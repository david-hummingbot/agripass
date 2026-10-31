<?php

declare(strict_types=1);

namespace AgriPass\Services;

use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

/** Streams a header + rows table as CSV or Excel. */
final class TableExport
{
    public const CSV = 'csv';
    public const XLSX = 'xlsx';

    public static function send(string $format, string $basename, string $sheetTitle, array $header, array $rows): void
    {
        header('Cache-Control: private, no-store');
        if ($format === self::XLSX) {
            self::xlsx("{$basename}.xlsx", $sheetTitle, $header, $rows);
        } else {
            self::csv("{$basename}.csv", $header, $rows);
        }
    }

    /** UTF-8 with a byte-order mark so Excel shows names like "Baños" correctly. */
    private static function csv(string $filename, array $header, array $rows): void
    {
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, $header);
        foreach ($rows as $row) {
            fputcsv($out, array_map([self::class, 'csvSafe'], $row));
        }
        fclose($out);
    }

    /**
     * Every cell is written with an explicit type, so attendee text is never evaluated as a formula and
     * identifiers like PRC license "0071234" keep their leading zeros.
     */
    private static function xlsx(string $filename, string $sheetTitle, array $header, array $rows): void
    {
        $book = new Spreadsheet();
        $sheet = $book->getActiveSheet();
        $sheet->setTitle(mb_substr($sheetTitle, 0, 31));

        foreach ([$header, ...$rows] as $r => $row) {
            foreach (array_values($row) as $c => $value) {
                $cell = Coordinate::stringFromColumnIndex($c + 1) . ($r + 1);
                $value = $value === null ? '' : (string) $value;
                $numeric = $r > 0 && is_numeric($value) && !preg_match('/^[+-]?0\d/', $value);
                $sheet->setCellValueExplicit($cell, $numeric ? (float) $value : $value, $numeric ? DataType::TYPE_NUMERIC : DataType::TYPE_STRING);
            }
        }

        $lastColumn = Coordinate::stringFromColumnIndex(max(1, count($header)));
        $sheet->getStyle("A1:{$lastColumn}1")->getFont()->setBold(true);
        $sheet->freezePane('A2');
        $sheet->setAutoFilter("A1:{$lastColumn}" . (count($rows) + 1));
        for ($c = 1; $c <= count($header); $c++) {
            $sheet->getColumnDimension(Coordinate::stringFromColumnIndex($c))->setAutoSize(true);
        }

        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        (new Xlsx($book))->save('php://output');
    }

    /** Neutralises spreadsheet formulas in attendee-supplied text (CSV injection). */
    private static function csvSafe(mixed $value): string
    {
        $value = $value === null ? '' : (string) $value;

        return $value !== '' && in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true) && !is_numeric($value) ? "'" . $value : $value;
    }
}
