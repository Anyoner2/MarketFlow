from django.contrib import admin

from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
	list_display = ['name', 'store', 'category', 'price', 'stock_quantity', 'is_active']
	list_filter = ['category', 'is_active', 'store']
	search_fields = ['name', 'description', 'store__name']
