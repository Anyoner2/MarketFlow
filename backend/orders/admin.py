from django.contrib import admin

from .models import Order, OrderItem


class OrderItemInline(admin.TabularInline):
	model = OrderItem
	extra = 0
	readonly_fields = ['product', 'quantity', 'unit_price']
	can_delete = False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
	list_display = ['order_number', 'customer', 'status', 'currency', 'created_at']
	list_filter = ['status', 'currency', 'created_at']
	search_fields = ['order_number', 'customer__email']
	readonly_fields = ['order_number', 'customer', 'currency', 'created_at', 'updated_at']
	inlines = [OrderItemInline]
