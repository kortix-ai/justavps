'use client';

import type { ComponentType, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type ResourceColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
};

export type ResourceListProps<T> = {
  title: ReactNode;
  description?: ReactNode;
  rows: T[];
  columns: ResourceColumn<T>[];
  rowKey: (row: T) => string;
  toolbar?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
};

export function ResourceList<T>({
  title,
  description,
  rows,
  columns,
  rowKey,
  toolbar,
  empty,
  footer,
  onRowClick,
  rowClassName,
}: ResourceListProps<T>) {
  return (
    <Card className="w-full">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {toolbar ? <div className="w-full lg:w-auto">{toolbar}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.key} className={column.headerClassName}>{column.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-32 text-center">
                    {empty ?? <div className="text-sm text-muted-foreground">No rows</div>}
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(onRowClick && 'cursor-pointer hover:bg-muted/50', rowClassName?.(row))}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>{column.cell(row)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {footer ? <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

export function ResourceStatCard({ icon: Icon, label, value, sub }: { icon: ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="rounded-lg bg-muted p-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
          {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
