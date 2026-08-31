/**
 * Properties screen — manage real estate holdings (add new, update valuation).
 *
 * Data source: latest.json holdings where platform === "real_estate".
 * Mutations: POST /api/property/import (bridge) → re-triggers export_json.py.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Edit2, Home, Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatInrCompact, MASK_TEXT } from '@/lib/format'
import { importProperty, deleteProperty, type PropertyImportRequest, type PropertyImportResponse, type PropertyDeleteResponse } from '@/lib/data'
import { useLatest } from '@/lib/data'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/utils'

type PropertyHolding = {
  property_id: string
  address: string
  property_type: string
  purchase_date: string
  purchase_price: number
  current_valuation: number
  return_pct: number | null
  as_of: string
  improvements: Array<{ date: string; amount: number; description?: string }>
}

type FormMode = 'add' | 'edit'
type Improvement = { date: string; amount: number; description: string }

const emptyImprovement: Improvement = { date: '', amount: 0, description: '' }

function formatDateForInput(iso: string): string {
  return iso.split('T')[0] ?? ''
}

function parsePropertyHolding(h: any): PropertyHolding {
  // Extract improvements from the raw JSON if available, otherwise empty
  // For now we don't persist improvements in the holding, so we reconstruct from trades
  // or allow user to re-enter. We'll show an empty array for now.
  return {
    property_id: h.ticker,
    address: h.name ?? '',
    property_type: h.sector?.toLowerCase() ?? 'residential',
    purchase_date: '', // not in holding; would need to come from trades
    purchase_price: h.avgPrice ?? 0,
    current_valuation: h.ltp ?? h.value,
    return_pct: h.returnPct,
    as_of: h.asOf,
    improvements: [],
  }
}

export function PropertiesScreen() {
  const { data: latest } = useLatest()
  const { masked } = usePrivacy()
  const queryClient = useQueryClient()

  // Filter real estate holdings
  const realEstateHoldings = (latest?.holdings ?? []).filter((h) => h.platform === 'real_estate')
  const properties = realEstateHoldings.map(parsePropertyHolding)

  // Form state
  const [mode, setMode] = useState<FormMode>('add')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<PropertyImportRequest>({
    property_id: '',
    address: '',
    property_type: 'residential',
    purchase_date: '',
    purchase_price: 0,
    current_valuation: 0,
    valuation_date: new Date().toISOString().split('T')[0],
    improvements: [],
  })
  const [improvements, setImprovements] = useState<Improvement[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Property import mutation
  const importMutation = useMutation({
    mutationFn: importProperty,
    onSuccess: (res: PropertyImportResponse) => {
      setMessage({ type: 'success', text: res.import ?? 'Property saved successfully' })
      queryClient.invalidateQueries({ queryKey: ['latest'] })
      queryClient.invalidateQueries({ queryKey: ['history'] })
      queryClient.invalidateQueries({ queryKey: ['xirr'] })
      resetForm()
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message })
    },
  })

  // Property delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteProperty,
    onSuccess: (res: PropertyDeleteResponse) => {
      setMessage({ type: 'success', text: `Deleted ${res.deleted ?? 'property'}` })
      queryClient.invalidateQueries({ queryKey: ['latest'] })
      queryClient.invalidateQueries({ queryKey: ['history'] })
      queryClient.invalidateQueries({ queryKey: ['xirr'] })
      setDeleteConfirm(null)
    },
    onError: (err: Error) => {
      setMessage({ type: 'error', text: err.message })
      setDeleteConfirm(null)
    },
  })

  function resetForm() {
    setMode('add')
    setEditingId(null)
    setFormData({
      property_id: '',
      address: '',
      property_type: 'residential',
      purchase_date: '',
      purchase_price: 0,
      current_valuation: 0,
      valuation_date: new Date().toISOString().split('T')[0],
      improvements: [],
    })
    setImprovements([])
  }

  function handleEdit(property: PropertyHolding) {
    setMode('edit')
    setEditingId(property.property_id)
    setFormData({
      property_id: property.property_id,
      address: property.address,
      property_type: property.property_type,
      purchase_date: property.purchase_date,
      purchase_price: property.purchase_price,
      current_valuation: property.current_valuation,
      valuation_date: new Date().toISOString().split('T')[0],
      improvements: property.improvements,
    })
    setImprovements(
      property.improvements.map((imp) => ({
        date: imp.date,
        amount: imp.amount,
        description: imp.description ?? '',
      }))
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload: PropertyImportRequest = {
      ...formData,
      improvements: improvements.map((imp) => ({
        date: imp.date,
        amount: imp.amount,
        description: imp.description,
      })),
    }
    importMutation.mutate(payload)
  }

  function addImprovement() {
    const today = new Date().toISOString().split('T')[0] ?? ''
    setImprovements([...improvements, { date: today, amount: 0, description: '' }])
  }

  function updateImprovement(index: number, field: keyof Improvement, value: string | number) {
    const newImps = [...improvements]
    const current = newImps[index] ?? emptyImprovement
    if (field === 'amount') {
      newImps[index] = { ...current, amount: Number(value) }
    } else if (field === 'date') {
      newImps[index] = { ...current, date: String(value) }
    } else {
      newImps[index] = { ...current, description: String(value) }
    }
    setImprovements(newImps)
  }

  function removeImprovement(index: number) {
    setImprovements(improvements.filter((_, i) => i !== index))
  }

  const totalValue = properties.reduce((sum, p) => sum + p.current_valuation, 0)
  const totalCost = properties.reduce((sum, p) => sum + p.purchase_price, 0)
  const totalGain = totalValue - totalCost
  const totalReturnPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Real Estate</h1>
          <p className="text-sm text-muted-foreground">
            Manage property holdings — add new or update valuations
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-4 text-sm">
            <span className="font-medium tabular-nums">
              {properties.length} propert{properties.length === 1 ? 'y' : 'ies'}
            </span>
            <span className="font-medium tabular-nums text-gain">
              {masked ? MASK_TEXT : formatInrCompact(totalValue)}
            </span>
          </div>
          <Button onClick={() => { setMode('add'); resetForm(); }} className="gap-2">
            <Plus className="size-4" />
            Add Property
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">Total Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-headline text-3xl tabular-nums">
              {masked ? MASK_TEXT : formatInrCompact(totalValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">Total Invested</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {masked ? MASK_TEXT : formatInrCompact(totalCost)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs text-muted-foreground">Unrealized Gain</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn('text-2xl font-semibold tabular-nums', totalGain >= 0 ? 'text-gain' : 'text-loss')}>
              {masked ? MASK_TEXT : (totalGain >= 0 ? '+' : '') + formatInrCompact(totalGain)}
            </div>
            <div className={cn('text-xs', totalGain >= 0 ? 'text-gain' : 'text-loss')}>
              {totalReturnPct.toFixed(2)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Message Toast */}
      {message && (
        <Alert className={cn(message.type === 'error' ? 'border-destructive' : '')}>
          {message.type === 'error' ? (
            <>
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{message.text}</AlertDescription>
            </>
          ) : (
            <AlertDescription className="text-green-700">{message.text}</AlertDescription>
          )}
        </Alert>
      )}

      {/* Properties List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="size-4" />
            Properties ({properties.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {properties.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No properties yet. Click "Add Property" to get started.
            </div>
          ) : (
            <div className="space-y-4">
              {properties.map((prop) => (
                <div
                  key={prop.property_id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10">
                      <Home className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{prop.address}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {prop.property_type.charAt(0).toUpperCase() + prop.property_type.slice(1)}
                        </Badge>
                        <span>ID: {prop.property_id}</span>
                        <span>As of {formatDateForInput(prop.as_of)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full sm:w-auto">
                    <div className="text-right min-w-[140px]">
                      <div className="text-sm text-muted-foreground">Current Value</div>
                      <div className="font-semibold tabular-nums">
                        {masked ? MASK_TEXT : formatInrCompact(prop.current_valuation)}
                      </div>
                    </div>
                    <div className="text-right min-w-[120px]">
                      <div className="text-sm text-muted-foreground">Invested</div>
                      <div className="font-medium tabular-nums">
                        {masked ? MASK_TEXT : formatInrCompact(prop.purchase_price)}
                      </div>
                    </div>
                    <div className={cn('text-right min-w-[100px]', prop.return_pct !== null && prop.return_pct < 0 ? 'text-loss' : 'text-gain')}>
                      <div className="text-sm text-muted-foreground">Return</div>
                      <div className="font-semibold tabular-nums">
                        {prop.return_pct !== null ? `${prop.return_pct >= 0 ? '+' : ''}${prop.return_pct.toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(prop)}
                        disabled={importMutation.isPending}
                      >
                        <Edit2 className="size-3.5" />
                        <span className="hidden sm:inline">Update</span>
                      </Button>
                      {deleteConfirm === prop.property_id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteMutation.mutate(prop.property_id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="size-3.5" />
                            <span className="hidden sm:inline">Confirm</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirm(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteConfirm(prop.property_id)}
                          disabled={deleteMutation.isPending || importMutation.isPending}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="hidden sm:inline">Delete</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {mode === 'add' ? (
              <>
                <Plus className="size-4" />
                Add New Property
              </>
            ) : (
              <>
                <Edit2 className="size-4" />
                Update Valuation: {editingId}
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="property_id">Property ID *</Label>
                <Input
                  id="property_id"
                  value={formData.property_id}
                  onChange={(e) => setFormData({ ...formData, property_id: e.target.value.toUpperCase() })}
                  placeholder="e.g. PROP_BLR_001"
                  disabled={mode === 'edit'}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="property_type">Property Type</Label>
                <Input
                  id="property_type"
                  value={formData.property_type}
                  onChange={(e) => setFormData({ ...formData, property_type: e.target.value.toLowerCase() })}
                  placeholder="residential / commercial"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="address">Address *</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="123 Whitefield, Bangalore, Karnataka"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="purchase_date">Purchase Date *</Label>
                <Input
                  id="purchase_date"
                  type="date"
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="purchase_price">Purchase Price (₹) *</Label>
                <Input
                  id="purchase_price"
                  type="number"
                  step="100000"
                  value={formData.purchase_price}
                  onChange={(e) => setFormData({ ...formData, purchase_price: Number(e.target.value) })}
                  placeholder="8500000"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="current_valuation">Current Valuation (₹) *</Label>
                <Input
                  id="current_valuation"
                  type="number"
                  step="100000"
                  value={formData.current_valuation}
                  onChange={(e) => setFormData({ ...formData, current_valuation: Number(e.target.value) })}
                  placeholder="12000000"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="valuation_date">Valuation Date</Label>
                <Input
                  id="valuation_date"
                  type="date"
                  value={formData.valuation_date}
                  onChange={(e) => setFormData({ ...formData, valuation_date: e.target.value })}
                />
              </div>
            </div>

            <Separator />

            {/* Improvements */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Improvements / Renovations (optional)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addImprovement}>
                  <Plus className="size-3.5 mr-1" />
                  Add
                </Button>
              </div>
              {improvements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Track capital improvements (kitchen remodel, bathroom, etc.) — they increase cost basis for returns.
                </p>
              ) : (
                <div className="space-y-3">
                  {improvements.map((imp, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row gap-3 p-3 border rounded-lg bg-muted/30">
                      <div className="space-y-1.5 flex-1">
                        <Label htmlFor={`imp_date_${idx}`} className="text-xs">
                          Date
                        </Label>
                        <Input
                          id={`imp_date_${idx}`}
                          type="date"
                          value={imp.date}
                          onChange={(e) => updateImprovement(idx, 'date', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <Label htmlFor={`imp_amount_${idx}`} className="text-xs">
                          Amount (₹)
                        </Label>
                        <Input
                          id={`imp_amount_${idx}`}
                          type="number"
                          step="10000"
                          value={imp.amount}
                          onChange={(e) => updateImprovement(idx, 'amount', Number(e.target.value))}
                          placeholder="500000"
                        />
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <Label htmlFor={`imp_desc_${idx}`} className="text-xs">
                          Description
                        </Label>
                        <Input
                          id={`imp_desc_${idx}`}
                          value={imp.description}
                          onChange={(e) => updateImprovement(idx, 'description', e.target.value)}
                          placeholder="Kitchen renovation"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeImprovement(idx)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Submit */}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={resetForm} disabled={importMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={importMutation.isPending}>
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : mode === 'add' ? (
                  'Add Property'
                ) : (
                  'Update Valuation'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}