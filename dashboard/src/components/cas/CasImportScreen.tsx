/**
 * CAS Import screen — upload your monthly Consolidated Account Statement (CAS)
 * PDF to import Groww/Sharekhan holdings (stocks + mutual funds).
 *
 * The CAS is a free, SEBI-mandated monthly statement emailed by CDSL/NSDL
 * (demat accounts) + CAMS/KFintech (MF folios). Parsed fully offline by the
 * casparser library — the PDF never leaves your machine.
 *
 * What it imports:
 *   - Groww demat MFs (no cost basis — value only)
 *   - Groww folio MFs (full cost basis + returns)
 *   - Sharekhan equities (value only, no cost)
 *   - Zerodha demat MFs (value only — equities skipped, live via MCP)
 *
 * After import, click "Refresh" in the header to update the dashboard.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { FileText, Upload, Key, Loader2, AlertCircle, Check, Mail, Clock, Zap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  importCas,
  requestCas,
  runCasAuto,
  useCasSchedule,
  updateCasSchedule,
  type CasImportResponse,
} from '@/lib/data'

const DASHBOARD_QUERY_KEYS = ['latest', 'history', 'xirr', 'alerts', 'performance'] as const

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function CasScheduleCard() {
  const queryClient = useQueryClient()
  const scheduleQuery = useCasSchedule()
  const [intervalInput, setIntervalInput] = useState<string | null>(null)

  const requestMutation = useMutation({
    mutationFn: requestCas,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas-schedule'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateCasSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cas-schedule'] })
      setIntervalInput(null)
    },
  })

  const autoMutation = useMutation({
    mutationFn: runCasAuto,
    onSuccess: (res) => {
      toast.success('CAS auto-import complete', {
        description: res.message || 'Requested, fetched, and imported successfully.',
      })
      queryClient.invalidateQueries({ queryKey: ['cas-schedule'] })
      for (const key of DASHBOARD_QUERY_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
    onError: (err) => {
      toast.error('CAS auto-import failed', {
        description: err instanceof Error ? err.message : 'An unexpected error occurred',
      })
    },
  })

  const schedule = scheduleQuery.data
  const displayedInterval = intervalInput ?? (schedule?.intervalDays?.toString() ?? '')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" />
          Request Fresh CAS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Asks CAMS/KFintech directly to email a fresh statement covering your
          Groww <em>folio</em> mutual funds — free, automated, no CAPTCHA. Not a
          replacement for the full monthly demat CAS below; demat holdings and
          equities aren't covered by this request. The PDF still arrives by
          email — upload it in the card below once it lands.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => requestMutation.mutate()}
            disabled={requestMutation.isPending || autoMutation.isPending}
          >
            {requestMutation.isPending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Requesting…
              </>
            ) : (
              <>
                <Mail className="size-4 mr-2" />
                Request Fresh CAS
              </>
            )}
          </Button>

          <Button
            variant="default"
            onClick={() => autoMutation.mutate()}
            disabled={autoMutation.isPending || requestMutation.isPending}
          >
            {autoMutation.isPending ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Running full auto-import… (up to ~10 min)
              </>
            ) : (
              <>
                <Zap className="size-4 mr-2" />
                Run Full Auto-Import
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          "Run Full Auto-Import" does everything unattended — request, wait for the
          email, download, and import — no manual upload needed. Success/failure
          shows as a notification when it finishes.
        </p>

        {requestMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Request failed</AlertTitle>
            <AlertDescription>
              {requestMutation.error instanceof Error
                ? requestMutation.error.message
                : 'An unexpected error occurred'}
            </AlertDescription>
          </Alert>
        )}

        {requestMutation.isSuccess && (
          <Alert>
            <Check className="size-4 text-gain" />
            <AlertTitle>Requested</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              Check your email in ~2 minutes, then upload the PDF below.
            </AlertDescription>
          </Alert>
        )}

        <div className="border-t border-border/30 pt-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground">
            <Clock className="size-3.5" />
            Automatic schedule
          </div>

          {scheduleQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Loading schedule…</p>
          )}

          {schedule && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>Last requested: {formatWhen(schedule.lastRequestedAt)}</span>
                <span>Next due: {formatWhen(schedule.nextDueAt)}</span>
              </div>

              <div className="flex items-center gap-2">
                <Label htmlFor="cas_interval" className="text-xs whitespace-nowrap">
                  Every
                </Label>
                <Input
                  id="cas_interval"
                  type="number"
                  min={1}
                  value={displayedInterval}
                  onChange={(e) => setIntervalInput(e.target.value)}
                  className="h-8 w-16 text-xs"
                  disabled={updateMutation.isPending}
                />
                <span className="text-xs text-muted-foreground">days</span>
                {intervalInput !== null && intervalInput !== schedule.intervalDays?.toString() && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={updateMutation.isPending || !intervalInput}
                    onClick={() => updateMutation.mutate({ intervalDays: Number(intervalInput) })}
                  >
                    Save
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={schedule.enabled ? 'outline' : 'secondary'}
                  className="h-8 text-xs ml-auto"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ enabled: !schedule.enabled })}
                >
                  {schedule.enabled ? 'Enabled' : 'Disabled'}
                </Button>
              </div>
            </>
          )}

          {updateMutation.isError && (
            <p className="text-xs text-destructive">
              {updateMutation.error instanceof Error
                ? updateMutation.error.message
                : 'Failed to update schedule'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function CasImportScreen() {
  const queryClient = useQueryClient()

  const [casFile, setCasFile] = useState<File | null>(null)
  const [casPassword, setCasPassword] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const casMutation = useMutation({
    mutationFn: ({ file, password }: { file: File; password: string }) =>
      importCas(file, password),
    onSuccess: (_res: CasImportResponse) => {
      // Invalidate all data queries to trigger a refresh
      queryClient.invalidateQueries({ queryKey: ['latest'] })
      queryClient.invalidateQueries({ queryKey: ['history'] })
      queryClient.invalidateQueries({ queryKey: ['xirr'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      queryClient.invalidateQueries({ queryKey: ['performance'] })
      setCasFile(null)
      setCasPassword('')
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f && f.type === 'application/pdf') {
      setCasFile(f)
    } else if (e.target.files?.[0]) {
      // Non-PDF selected
    }
  }

  const handleImport = () => {
    if (casFile) {
      casMutation.mutate({ file: casFile, password: casPassword })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">CAS Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import Groww and Sharekhan holdings — stocks and mutual funds — from
          a Consolidated Account Statement (CAS) PDF. Request a fresh
          Groww-folio statement on demand below, or upload the full monthly
          statement you get by email.
        </p>
      </div>

      {/* What CAS Is */}
      <Alert>
        <AlertCircle className="size-4" />
        <AlertTitle>About the CAS</AlertTitle>
        <AlertDescription>
          <p className="text-xs text-muted-foreground mb-2">
            The CAS (Consolidated Account Statement) is a free, SEBI-mandated
            report emailed to you by CDSL/NSDL (demat accounts) and CAMS/KFintech
            (MF folios). A full demat + MF-folio statement still arrives monthly by
            email; "Request Fresh CAS" below asks CAMS/KFintech directly for an
            updated statement covering your Groww <em>folio</em> mutual funds
            only (not demat holdings or equities), automatically, on a schedule.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 text-xs">
            <div>
              <span className="font-medium text-foreground">Parsed offline</span>
              <span className="text-muted-foreground"> — via the MIT-licensed casparser library. The PDF never leaves this machine.</span>
            </div>
            <div>
              <span className="font-medium text-foreground">Updates</span>
              <span className="text-muted-foreground"> — refreshed daily via AMFI NAV for MF pricing.</span>
            </div>
          </div>
        </AlertDescription>
      </Alert>

      <CasScheduleCard />

      {/* Import Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Upload CAS PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {casFile ? (
            <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="size-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate text-sm">{casFile.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(casFile.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCasFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                disabled={casMutation.isPending}
              >
                Clear
              </Button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed border-border/50 rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 hover:border-border transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">Click to select CAS PDF</p>
              <p className="text-xs text-muted-foreground mt-1">
                Only .pdf files, max 10MB
              </p>
              <input
                type="file"
                ref={fileInputRef}
                accept="application/pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          )}

          {casFile && (
            <>
              <div className="space-y-2">
                <Label htmlFor="cas_password" className="text-xs">
                  PDF Password (if encrypted)
                </Label>
                <div className="relative">
                  <Key className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="cas_password"
                    type="password"
                    value={casPassword}
                    onChange={(e) => setCasPassword(e.target.value)}
                    placeholder="CAS PDF password (if applicable)"
                    className="h-8 pl-7 text-xs"
                    disabled={casMutation.isPending}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Most CAS PDFs are unencrypted — leave blank unless you know otherwise.
                </p>
              </div>

              <Button
                onClick={handleImport}
                disabled={casMutation.isPending}
                className="w-full"
              >
                {casMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Parsing CAS… (may take a minute for large statements)
                  </>
                ) : (
                  <>
                    <FileText className="size-4 mr-2" />
                    Import CAS Statement
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Result Message */}
      {casMutation.isError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Import failed</AlertTitle>
          <AlertDescription>
            {casMutation.error instanceof Error
              ? casMutation.error.message
              : 'An unexpected error occurred'}
          </AlertDescription>
        </Alert>
      )}

      {casMutation.isSuccess && casMutation.data?.ok && (
        <Alert>
          <Check className="size-4 text-gain" />
          <AlertTitle>Import successful</AlertTitle>
          <AlertDescription>
            <p className="text-xs text-muted-foreground mb-2">
              CAS imported successfully. Click <strong>Refresh</strong> in the header
              to update the dashboard with your new holdings.
            </p>
            {casMutation.data.import && (
              <pre className="text-xs bg-muted/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                {casMutation.data.import}
              </pre>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">1. </span>
            <span>casparser</span><span className="text-muted-foreground"> parses the PDF locally (offline). No data is uploaded anywhere.</span>
          </div>
          <div>
            <span className="font-medium text-foreground">2. </span>
            <span>Extracts</span><span className="text-muted-foreground"> holdings (stocks + MFs) attributed to Groww, Sharekhan, and Zerodha MFs.</span>
          </div>
          <div>
            <span className="font-medium text-foreground">3. </span>
            <span>Import</span><span className="text-muted-foreground"> writes to your local portfolio database — same as the scheduled pipeline.</span>
          </div>
          <div>
            <span className="font-medium text-foreground">4. </span>
            <span>Refresh</span><span className="text-muted-foreground"> the dashboard to see updated holdings, returns, and allocations.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}