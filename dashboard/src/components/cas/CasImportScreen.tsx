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
import { FileText, Upload, Key, Loader2, AlertCircle, Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { importCas, type CasImportResponse } from '@/lib/data'

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
          Upload your monthly Consolidated Account Statement (CAS) PDF to import
          Groww and Sharekhan holdings — stocks and mutual funds.
        </p>
      </div>

      {/* What CAS Is */}
      <Alert>
        <AlertCircle className="size-4" />
        <AlertTitle>About the CAS</AlertTitle>
        <AlertDescription>
          <p className="text-xs text-muted-foreground mb-2">
            The CAS (Consolidated Account Statement) is a free, SEBI-mandated monthly
            report emailed to you by CDSL/NSDL (demat accounts) and CAMS/KFintech
            (MF folios). It covers every demat + MF folio under your PAN.
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