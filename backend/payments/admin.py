from django.contrib import admin

from .models import Payment


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
	list_display = ['order', 'amount', 'currency', 'status', 'provider', 'created_at']
	list_filter = ['status', 'provider', 'currency', 'created_at']
	search_fields = ['order__order_number', 'provider_reference']
	readonly_fields = ['order', 'amount', 'currency', 'provider_reference', 'created_at', 'updated_at']
